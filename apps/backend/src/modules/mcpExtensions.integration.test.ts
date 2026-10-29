import { createHash, randomBytes, randomUUID } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AuthContext } from "./auth.js";
import {
  connectMcpConnection,
  createMcpConnection,
  disconnectMcpConnection,
  listMcpConnections,
  updateMcpConnection,
  type McpInboundDependencies,
} from "./mcpConnections.js";
import {
  createMcpClientGrant,
  listMcpClientGrants,
  resolveMcpGrant,
  revokeMcpClientGrant,
} from "./mcpGrants.js";
import { loadMcpEncryptionKey } from "./mcpSecurity.js";
import { createWorkspaceMcpConnections } from "./mcpAgentTools.js";

/**
 * Synthetic integration coverage. Uses an isolated PostgreSQL database and a
 * loopback synthetic MCP server. No real provider or third-party server is
 * contacted.
 */

const url = process.env.CONTACT_AGENT_TEST_DATABASE_URL;
const pool = url
  ? new Pool({ connectionString: url, idleTimeoutMillis: 0, max: 4 })
  : null;

const accountId = randomUUID();
const accountSlug = `mcp-${randomUUID()}`;
const makeContext = (
  prefix: string,
  kind: "simulated_human" | "lab_human" = "simulated_human",
): AuthContext => ({
  accountId: randomUUID(),
  accountSlug: `mcp-${prefix}-${randomUUID()}`,
  sessionId: randomUUID(),
  userEmail: `mcp-${prefix}@synthetic.local`,
  userId: randomUUID(),
  userKind: kind,
});
const auth: AuthContext = {
  accountId,
  accountSlug,
  sessionId: randomUUID(),
  userEmail: "mcp-owner@synthetic.local",
  userId: randomUUID(),
  userKind: "simulated_human",
};
const other = makeContext("other");
const disabledIssuer = makeContext("disabled");
const lab = makeContext("lab", "lab_human");
const labOwner = makeContext("lab-owner");
const revokedSession = makeContext("revoked-session");
const raceContext = makeContext("race");
const allContexts = [
  auth,
  other,
  disabledIssuer,
  lab,
  labOwner,
  revokedSession,
  raceContext,
];
const allAccountIds = allContexts.map((context) => context.accountId);

const encryptionKey = loadMcpEncryptionKey(
  Buffer.alloc(32, 5).toString("base64"),
);
if (!encryptionKey) throw new Error("synthetic key");

const publicOrigin = "https://app.example.test";
const servers: http.Server[] = [];

async function startSyntheticMcpServer(paginatedTools?: Record<string, unknown>[]): Promise<{
  origin: string;
  close: () => Promise<void>;
  methods: string[];
}> {
  const methods: string[] = [];
  const server = http.createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
      id?: number;
      method: string;
      params?: { cursor?: string };
    };
    methods.push(body.method);
    if (body.method === "initialize") {
      response.writeHead(200, { "content-type": "application/json" });
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
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        id: body.id,
        jsonrpc: "2.0",
        result: paginatedTools ? {
          tools: body.params?.cursor === "synthetic-page-2" ? paginatedTools.slice(30) : paginatedTools.slice(0, 30),
          ...(body.params?.cursor ? {} : { nextCursor: "synthetic-page-2" }),
        } : {
          tools: [
            { annotations: { readOnlyHint: true }, description: "one", name: "one" },
          ],
        },
      }),
    );
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    methods,
    close: () =>
      new Promise<void>((resolve) => server.close(() => resolve())),
    origin: `http://127.0.0.1:${port}`,
  };
}

/** Echoes the request Authorization header in its error payload. */
async function startEchoErrorServer(): Promise<{
  origin: string;
  close: () => Promise<void>;
}> {
  const server = http.createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
      id?: number;
      method: string;
    };
    if (body.method === "initialize") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          id: body.id,
          jsonrpc: "2.0",
          result: {
            capabilities: {},
            protocolVersion: "2025-11-25",
            serverInfo: { name: "synthetic-echo", version: "1" },
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
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        error: {
          code: -32000,
          message: `echo ${request.headers.authorization ?? ""} ${body.method}`,
        },
        id: body.id,
        jsonrpc: "2.0",
      }),
    );
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    close: () =>
      new Promise<void>((resolve) => server.close(() => resolve())),
    origin: `http://127.0.0.1:${port}`,
  };
}

function dependencies(...origins: string[]): McpInboundDependencies {
  return {
    allowedOrigins: origins,
    encryptionKey,
    resolver: async () => [{ address: "127.0.0.1", family: 4 }],
  };
}

beforeAll(async () => {
  if (!pool) return;
  await pool.query(
    "INSERT INTO accounts(id,slug,name) VALUES($1,$2,'Synthetic MCP workspace')",
    [accountId, accountSlug],
  );
  for (const context of allContexts) {
    if (context.accountId === accountId) continue;
    await pool.query(
      "INSERT INTO accounts(id,slug,name) VALUES($1,$2,'Synthetic MCP workspace')",
      [context.accountId, context.accountSlug],
    );
  }
  for (const context of allContexts) {
    await pool.query(
      "INSERT INTO users(id,account_id,email,display_name,kind) VALUES($1,$2,$3,'Synthetic owner',$4)",
      [context.userId, context.accountId, context.userEmail, context.userKind],
    );
    // Real synthetic sessions: grant creation rechecks the issuing session and
    // lab authority inside its transaction, so fixtures are not waived.
    await pool.query(
      "INSERT INTO sessions(id,account_id,user_id,token_hash,client_label,expires_at) VALUES ($1,$2,$3,$4,'synthetic',clock_timestamp()+interval '1 hour')",
      [
        context.sessionId,
        context.accountId,
        context.userId,
        randomBytes(32).toString("hex"),
      ],
    );
  }
}, 30_000);

afterAll(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
  if (pool) {
    await pool
      .query(
        `DELETE FROM lab_test_workspace_entries WHERE workspace_id IN (
           SELECT id FROM lab_test_workspaces WHERE target_account_id = ANY($1::uuid[]));
         DELETE FROM lab_test_workspaces WHERE target_account_id = ANY($1::uuid[]);
         DELETE FROM sessions WHERE account_id = ANY($1::uuid[]);
         DELETE FROM mcp_connections WHERE account_id = ANY($1::uuid[]);
         DELETE FROM mcp_client_grants WHERE account_id = ANY($1::uuid[]);
         DELETE FROM idempotency_records WHERE account_id = ANY($1::uuid[]);
         DELETE FROM audit_events WHERE account_id = ANY($1::uuid[]);
         DELETE FROM users WHERE account_id = ANY($1::uuid[]);
         DELETE FROM accounts WHERE id = ANY($1::uuid[]);`,
        [allAccountIds],
      )
      .catch(() => undefined);
  }
  await pool?.end();
});

describe.skipIf(!pool)("MCP extensions persistence", () => {
  it("discovers tool 40 through real paginated HTTP, persists it, and reads its complete schema", async () => {
    const schema = { type: "object", properties: { max_tokens: { type: "integer", enum: [128, 256] },
      prompt: { type: "string", description: "Long schema annotation. ".repeat(220) } }, required: ["prompt"] };
    const server = await startSyntheticMcpServer(Array.from({ length: 40 }, (_, index) => ({
      name: `tool_${index + 1}`, description: `Synthetic tool ${index + 1}`, inputSchema: schema,
    })));
    const dependencies = { allowedOrigins: [server.origin], encryptionKey,
      resolver: async () => [{ address: "127.0.0.1", family: 4 }] };
    const created = await createMcpConnection(pool!, auth, {
      friendly_name: "Paginated discovery fixture", server_url: `${server.origin}/mcp`, idempotency_key: randomUUID() }, dependencies);
    const adapter = createWorkspaceMcpConnections({ pool: pool!, auth, sessionID: null,
      messageID: randomUUID(), dependencies });
    const connected = await adapter.handle({ operation: "connect", connection_id: created.connection.id });
    expect(connected).toMatchObject({ ok: true, data: { tools_count: 40, tools_complete: false, next_tool_offset: 30 } });
    expect(server.methods).toEqual(["initialize", "notifications/initialized", "tools/list", "tools/list"]);
    const next = await adapter.handle({ operation: "list", connection_id: created.connection.id, tool_offset: 30 });
    expect(next).toMatchObject({ ok: true, data: { connections: [{ tools_complete: true, next_tool_offset: null,
      tools: expect.arrayContaining([expect.objectContaining({ name: "tool_40" })]) }] } });
    const read = await adapter.handle({ operation: "read_tool", connection_id: created.connection.id, tool_name: "tool_40" });
    expect(read.ok).toBe(true);
    const schemaText = (read.data as { tool: { input_schema: string } }).tool.input_schema;
    expect(schemaText.length).toBeGreaterThan(4_000);
    expect(JSON.parse(schemaText)).toEqual(schema);
    const foreign = createWorkspaceMcpConnections({ pool: pool!, auth: other, sessionID: null, messageID: randomUUID(), dependencies });
    expect(await foreign.handle({ operation: "read_tool", connection_id: created.connection.id, tool_name: "tool_40" }))
      .toMatchObject({ ok: false, error: { code: "MCP_CALL_TARGET_NOT_FOUND" } });
    expect(server.methods).not.toContain("tools/call");
  });

  it("stores connections per account without ever returning the credential", async () => {
    const created = await createMcpConnection(
      pool!,
      auth,
      {
        bearer_secret: "synthetic-super-secret",
        friendly_name: "Synthetic CRM",
        idempotency_key: randomUUID(),
        server_url: "https://mcp.example.com/mcp",
      },
      {
        encryptionKey,
        resolver: async () => [{ address: "93.184.216.34", family: 4 }],
      },
    );
    expect(created.connection).toMatchObject({
      credential_configured: true,
      friendly_name: "Synthetic CRM",
      status: "disconnected",
      tools_count: 0,
    });
    expect(JSON.stringify(created)).not.toContain("synthetic-super-secret");

    const stored = await pool!.query<{ credential_ciphertext: string }>(
      "SELECT credential_ciphertext FROM mcp_connections WHERE account_id=$1 AND id=$2",
      [auth.accountId, created.connection.id],
    );
    expect(stored.rows[0]?.credential_ciphertext).not.toContain(
      "synthetic-super-secret",
    );
    expect(stored.rows[0]?.credential_ciphertext).toMatch(/^v1\./u);

    expect((await listMcpConnections(pool!, other)).connections).toEqual([]);
    expect(
      (
        await listMcpConnections(pool!, auth)
      ).connections.map((connection) => connection.id),
    ).toContain(created.connection.id);
    await expect(
      disconnectMcpConnection(pool!, other, created.connection.id, {
        expected_revision: created.connection.revision,
        idempotency_key: randomUUID(),
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("refuses to store a credential when the deployment key is absent", async () => {
    await expect(
      createMcpConnection(
        pool!,
        auth,
        {
          bearer_secret: "synthetic-secret",
          friendly_name: "No key",
          idempotency_key: randomUUID(),
          server_url: "https://mcp.example.com/mcp",
        },
        {
          encryptionKey: null,
          resolver: async () => [{ address: "93.184.216.34", family: 4 }],
        },
      ),
    ).rejects.toMatchObject({ code: "MCP_CREDENTIAL_UNAVAILABLE" });
  });

  it("verifies a real handshake, then clears credential and discovery on disconnect", async () => {
    const synthetic = await startSyntheticMcpServer();
    const deps = dependencies(synthetic.origin);
    try {
      const created = await createMcpConnection(
        pool!,
        auth,
        {
          bearer_secret: "local-token",
          friendly_name: "Local developer server",
          idempotency_key: randomUUID(),
          server_url: `${synthetic.origin}/mcp`,
        },
        deps,
      );
      const connected = await connectMcpConnection(
        pool!,
        auth,
        created.connection.id,
        {
          expected_revision: created.connection.revision,
          idempotency_key: randomUUID(),
        },
        deps,
      );
      expect(connected.connection).toMatchObject({
        status: "verified",
        tools_count: 1,
      });
      expect(connected.connection.tools[0]?.name).toBe("one");
      expect(connected.connection.last_checked_at).not.toBeNull();

      const retested = await connectMcpConnection(
        pool!,
        auth,
        created.connection.id,
        {
          expected_revision: connected.connection.revision,
          idempotency_key: randomUUID(),
        },
        deps,
      );
      expect(retested.connection).toMatchObject({
        credential_configured: true,
        status: "verified",
      });

      await expect(
        disconnectMcpConnection(pool!, auth, created.connection.id, {
          expected_revision: connected.connection.revision,
          idempotency_key: randomUUID(),
        }),
      ).rejects.toMatchObject({ code: "MCP_CONNECTION_CHANGED" });

      const disconnected = await disconnectMcpConnection(
        pool!,
        auth,
        created.connection.id,
        {
          expected_revision: retested.connection.revision,
          idempotency_key: randomUUID(),
        },
      );
      expect(disconnected.connection).toMatchObject({
        credential_configured: false,
        last_checked_at: null,
        status: "disconnected",
        tools: [],
        tools_count: 0,
      });

      const edited = await updateMcpConnection(
        pool!,
        auth,
        created.connection.id,
        {
          expected_revision: disconnected.connection.revision,
          friendly_name: "Renamed",
          idempotency_key: randomUUID(),
          server_url: `${synthetic.origin}/mcp`,
        },
        deps,
      );
      expect(edited.connection).toMatchObject({
        friendly_name: "Renamed",
        status: "disconnected",
      });
      await expect(
        updateMcpConnection(
          pool!,
          auth,
          created.connection.id,
          {
            expected_revision: disconnected.connection.revision,
            friendly_name: "Stale",
            idempotency_key: randomUUID(),
            server_url: `${synthetic.origin}/mcp`,
          },
          deps,
        ),
      ).rejects.toMatchObject({ code: "MCP_CONNECTION_CHANGED" });
    } finally {
      await synthetic.close();
    }
  });

  it("issues hash-only scoped tokens and revokes them immediately", async () => {
    const created = await createMcpClientGrant(
      pool!,
      auth,
      {
        expires_in_days: 7,
        idempotency_key: randomUUID(),
        name: "Synthetic desktop client",
        scopes: ["workspace_metadata_read"],
      },
      publicOrigin,
    );
    expect(created.token.startsWith("tsmcp_")).toBe(true);
    expect(created.endpoint.streamable_http_url).toBe(
      `${publicOrigin}/api/mcp`,
    );
    expect(created.endpoint.configuration_json).toContain(created.token);
    expect(created.grant).toMatchObject({
      scopes: ["workspace_metadata_read"],
      status: "active",
    });
    expect(JSON.stringify(created.grant)).not.toContain(created.token);

    const hash = createHash("sha256").update(created.token).digest("hex");
    const stored = await pool!.query<{ token_hash: string; token_hint: string }>(
      "SELECT token_hash, token_hint FROM mcp_client_grants WHERE account_id=$1 AND id=$2",
      [auth.accountId, created.grant.id],
    );
    expect(stored.rows[0]?.token_hash).toBe(hash);
    expect(stored.rows[0]?.token_hint).not.toBe(created.token);

    const grant = await resolveMcpGrant(pool!, `Bearer ${created.token}`);
    expect(grant).toMatchObject({
      accountId: auth.accountId,
      grantId: created.grant.id,
      scopes: ["workspace_metadata_read"],
    });
    expect(await resolveMcpGrant(pool!, "Bearer not-an-mcp-token")).toBeNull();

    expect((await listMcpClientGrants(pool!, other)).grants).toEqual([]);

    await expect(
      revokeMcpClientGrant(pool!, auth, created.grant.id, {
        expected_revision: created.grant.revision + 5,
        idempotency_key: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "MCP_CLIENT_CHANGED" });
    const revoked = await revokeMcpClientGrant(pool!, auth, created.grant.id, {
      expected_revision: created.grant.revision,
      idempotency_key: randomUUID(),
    });
    expect(revoked.grant.status).toBe("revoked");
    expect(await resolveMcpGrant(pool!, `Bearer ${created.token}`)).toBeNull();

    const expiring = await createMcpClientGrant(
      pool!,
      auth,
      {
        expires_in_days: 1,
        idempotency_key: randomUUID(),
        name: "Expiring client",
        scopes: ["workspace_metadata_read", "people_directory_read"],
      },
      publicOrigin,
    );
    await pool!.query(
      "UPDATE mcp_client_grants SET created_at = clock_timestamp() - interval '2 days', expires_at = clock_timestamp() - interval '1 day' WHERE account_id=$1 AND id=$2",
      [auth.accountId, expiring.grant.id],
    );
    expect(await resolveMcpGrant(pool!, `Bearer ${expiring.token}`)).toBeNull();

    await expect(
      createMcpClientGrant(
        pool!,
        auth,
        {
          expires_in_days: 7,
          idempotency_key: randomUUID(),
          name: "No endpoint",
          scopes: ["workspace_metadata_read"],
        },
        null,
      ),
    ).rejects.toMatchObject({ code: "MCP_ENDPOINT_NOT_CONFIGURED" });
  });

  it("discards a late handshake result after a concurrent disconnect", async () => {
    let releaseTools: (() => void) | undefined;
    const toolsGate = new Promise<void>((resolve) => {
      releaseTools = resolve;
    });
    let toolsStarted: (() => void) | undefined;
    const toolsReached = new Promise<void>((resolve) => {
      toolsStarted = resolve;
    });
    const server = http.createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        id?: number;
        method: string;
      };
      if (body.method === "initialize") {
        response.writeHead(200, { "content-type": "application/json" });
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
      toolsStarted?.();
      await toolsGate;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          id: body.id,
          jsonrpc: "2.0",
          result: {
            tools: [
              { annotations: { readOnlyHint: true }, description: "late", name: "late" },
            ],
          },
        }),
      );
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    const origin = `http://127.0.0.1:${port}`;
    const deps = dependencies(origin);
    const created = await createMcpConnection(
      pool!,
      auth,
      {
        bearer_secret: "local-token",
        friendly_name: "In-flight disconnect",
        idempotency_key: randomUUID(),
        server_url: `${origin}/mcp`,
      },
      deps,
    );
    const connecting = connectMcpConnection(pool!, auth, created.connection.id, {
      expected_revision: created.connection.revision,
      idempotency_key: randomUUID(),
    }, deps);
    await toolsReached;
    const disconnected = await disconnectMcpConnection(
      pool!,
      auth,
      created.connection.id,
      {
        expected_revision: created.connection.revision,
        idempotency_key: randomUUID(),
      },
    );
    expect(disconnected.connection).toMatchObject({ status: "disconnected" });
    releaseTools?.();
    const late = await connecting;
    expect(late.connection).toMatchObject({
      credential_configured: false,
      status: "disconnected",
      tools: [],
      tools_count: 0,
    });
    const persisted = await listMcpConnections(pool!, auth);
    const record = persisted.connections.find(
      (connection) => connection.id === created.connection.id,
    );
    expect(record).toMatchObject({
      credential_configured: false,
      status: "disconnected",
      tools: [],
    });
  });

  it("clears a stored credential when the endpoint changes without a new secret", async () => {
    const first = await startSyntheticMcpServer();
    const second = await startSyntheticMcpServer();
    const deps = dependencies(first.origin, second.origin);
    try {
      const created = await createMcpConnection(
        pool!,
        auth,
        {
          bearer_secret: "origin-a-secret",
          friendly_name: "Origin change",
          idempotency_key: randomUUID(),
          server_url: `${first.origin}/mcp`,
        },
        deps,
      );
      expect(created.connection.credential_configured).toBe(true);

      const renamed = await updateMcpConnection(
        pool!,
        auth,
        created.connection.id,
        {
          expected_revision: created.connection.revision,
          friendly_name: "Origin rename",
          idempotency_key: randomUUID(),
          server_url: `${first.origin}/mcp`,
        },
        deps,
      );
      expect(renamed.connection.credential_configured).toBe(true);

      const moved = await updateMcpConnection(
        pool!,
        auth,
        created.connection.id,
        {
          expected_revision: renamed.connection.revision,
          friendly_name: "Origin change",
          idempotency_key: randomUUID(),
          server_url: `${second.origin}/mcp`,
        },
        deps,
      );
      expect(moved.connection.credential_configured).toBe(false);
      const stored = await pool!.query<{ credential_ciphertext: string | null }>(
        "SELECT credential_ciphertext FROM mcp_connections WHERE account_id=$1 AND id=$2",
        [auth.accountId, created.connection.id],
      );
      expect(stored.rows[0]?.credential_ciphertext).toBeNull();
    } finally {
      await first.close();
      await second.close();
    }
  });

  it("never persists a server-authored error message or echoed credential", async () => {
    const sentinel = `sentinel-${randomUUID()}`;
    const server = await startEchoErrorServer();
    const deps = dependencies(server.origin);
    try {
      const created = await createMcpConnection(
        pool!,
        auth,
        {
          bearer_secret: sentinel,
          friendly_name: "Echo server",
          idempotency_key: randomUUID(),
          server_url: `${server.origin}/mcp`,
        },
        deps,
      );
      const attempted = await connectMcpConnection(
        pool!,
        auth,
        created.connection.id,
        {
          expected_revision: created.connection.revision,
          idempotency_key: randomUUID(),
        },
        deps,
      );
      expect(attempted.connection.status).toBe("failed");
      expect(attempted.connection.last_error_code).toBe("MCP_HANDSHAKE_FAILED");
      expect(attempted.connection.last_error_message).not.toContain(sentinel);
      expect(JSON.stringify(attempted)).not.toContain(sentinel);
      const stored = await pool!.query<{ last_error_message: string | null }>(
        "SELECT last_error_message FROM mcp_connections WHERE account_id=$1 AND id=$2",
        [auth.accountId, created.connection.id],
      );
      expect(stored.rows[0]?.last_error_message).not.toContain(sentinel);
    } finally {
      await server.close();
    }
  });

  it("rejects a grant whose issuing user is disabled", async () => {
    const created = await createMcpClientGrant(
      pool!,
      disabledIssuer,
      {
        expires_in_days: 7,
        idempotency_key: randomUUID(),
        name: "Disabled issuer",
        scopes: ["workspace_metadata_read"],
      },
      publicOrigin,
    );
    expect(await resolveMcpGrant(pool!, `Bearer ${created.token}`)).toMatchObject({
      accountId: disabledIssuer.accountId,
    });
    await pool!.query(
      "UPDATE users SET status='revoked' WHERE account_id=$1 AND id=$2",
      [disabledIssuer.accountId, disabledIssuer.userId],
    );
    expect(await resolveMcpGrant(pool!, `Bearer ${created.token}`)).toBeNull();
    await expect(
      createMcpClientGrant(
        pool!,
        disabledIssuer,
        {
          expires_in_days: 7,
          idempotency_key: randomUUID(),
          name: "Inactive member",
          scopes: ["workspace_metadata_read"],
        },
        publicOrigin,
      ),
    ).rejects.toMatchObject({ code: "MCP_ISSUER_NOT_ACTIVE" });
  });

  it("rejects grant creation for a revoked issuing session", async () => {
    await pool!.query("UPDATE sessions SET revoked_at=now() WHERE id=$1", [
      revokedSession.sessionId,
    ]);
    await expect(
      createMcpClientGrant(
        pool!,
        revokedSession,
        {
          expires_in_days: 7,
          idempotency_key: randomUUID(),
          name: "Revoked session",
          scopes: ["workspace_metadata_read"],
        },
        publicOrigin,
      ),
    ).rejects.toMatchObject({ code: "MCP_ISSUER_NOT_ACTIVE" });
    const stored = await pool!.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM mcp_client_grants WHERE account_id=$1",
      [revokedSession.accountId],
    );
    expect(stored.rows[0]?.count).toBe(0);
  });

  it("cannot create a grant while a concurrent suspension wins", async () => {
    const suspend = await pool!.connect();
    try {
      await suspend.query("BEGIN");
      await suspend.query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE", [
        raceContext.accountId,
      ]);
      await suspend.query(
        "UPDATE users SET status='revoked' WHERE account_id=$1 AND id=$2",
        [raceContext.accountId, raceContext.userId],
      );
      const creating = createMcpClientGrant(
        pool!,
        raceContext,
        {
          expires_in_days: 7,
          idempotency_key: randomUUID(),
          name: "Race client",
          scopes: ["workspace_metadata_read"],
        },
        publicOrigin,
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
      await suspend.query("COMMIT");
      await expect(creating).rejects.toMatchObject({
        code: "MCP_ISSUER_NOT_ACTIVE",
      });
      const stored = await pool!.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM mcp_client_grants WHERE account_id=$1",
        [raceContext.accountId],
      );
      expect(stored.rows[0]?.count).toBe(0);
    } finally {
      suspend.release();
    }
  });

  it("checks the deployment audience and lab activity for a grant", async () => {
    const audienceGrant = await createMcpClientGrant(
      pool!,
      auth,
      {
        expires_in_days: 7,
        idempotency_key: randomUUID(),
        name: "Audience client",
        scopes: ["workspace_metadata_read"],
      },
      publicOrigin,
    );
    expect(
      await resolveMcpGrant(pool!, `Bearer ${audienceGrant.token}`, {
        deploymentWorkspaceIds: [other.accountId],
      }),
    ).toBeNull();
    expect(
      await resolveMcpGrant(pool!, `Bearer ${audienceGrant.token}`, {
        deploymentWorkspaceIds: [auth.accountId],
      }),
    ).toMatchObject({ accountId: auth.accountId });

    const labSession = lab.sessionId;
    const ownerSession = labOwner.sessionId;
    const workspaceId = randomUUID();
    await pool!.query(
      `INSERT INTO lab_test_workspaces(
         id, owner_account_id, owner_user_id, target_account_id, target_user_id,
         duration_hours, expires_at, state, media_scope_hash
       ) VALUES ($1,$2,$3,$4,$5,1,clock_timestamp()+interval '1 hour','active',$6)`,
      [
        workspaceId,
        labOwner.accountId,
        labOwner.userId,
        lab.accountId,
        lab.userId,
        randomBytes(32).toString("hex"),
      ],
    );
    await pool!.query(
      `INSERT INTO lab_test_workspace_entries(
         id, workspace_id, owner_session_id, session_id, token_hash, expires_at
       ) VALUES ($1,$2,$3,$4,$5,clock_timestamp()+interval '1 hour')`,
      [
        randomUUID(),
        workspaceId,
        ownerSession,
        labSession,
        randomBytes(32).toString("hex"),
      ],
    );
    const labGrant = await createMcpClientGrant(
      pool!,
      lab,
      {
        expires_in_days: 7,
        idempotency_key: randomUUID(),
        name: "Lab client",
        scopes: ["workspace_metadata_read"],
      },
      publicOrigin,
    );
    expect(await resolveMcpGrant(pool!, `Bearer ${labGrant.token}`)).toMatchObject({
      accountId: lab.accountId,
    });
    await pool!.query(
      "UPDATE lab_test_workspaces SET expires_at = clock_timestamp() - interval '1 second' WHERE id=$1",
      [workspaceId],
    );
    expect(await resolveMcpGrant(pool!, `Bearer ${labGrant.token}`)).toBeNull();
  });
});
