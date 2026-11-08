import Fastify from "fastify";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { performMcpHandshake } from "./mcpClient.js";
import { resolveMcpServerUrl } from "./mcpSecurity.js";
import {
  createMcpToolRegistry,
  handleMcpHttpRequest,
  registerMcpServerRoutes,
  type McpServerDependencies,
  type McpTool,
} from "./mcpServer.js";

const PUBLIC_ORIGIN = "https://app.example.test";
const TOKEN = "tsmcp_synthetic_token_value_for_tests";

function tool(
  name: string,
  scope: McpTool["scope"],
  result: Record<string, unknown> = { ok: true },
): McpTool {
  return {
    call: async () => ({ structuredContent: result }),
    description: `${name} description`,
    inputSchema: { additionalProperties: false, properties: {}, type: "object" },
    name,
    readOnly: true,
    scope,
  };
}

function dependencies(overrides: Partial<McpServerDependencies> = {}): McpServerDependencies {
  return {
    publicOrigin: PUBLIC_ORIGIN,
    resolveGrant: async (authorization) =>
      authorization === `Bearer ${TOKEN}`
        ? {
            accountId: "10000000-0000-4000-8000-000000000001",
            createdByUserId: "10000000-0000-4000-8000-000000000002",
            grantId: "10000000-0000-4000-8000-000000000003",
            name: "Synthetic client",
            scopes: ["workspace_metadata_read", "people_directory_read"],
          }
        : null,
    tools: [tool("talent_signal_workspace", "workspace_metadata_read")],
    ...overrides,
  };
}

const apps: ReturnType<typeof Fastify>[] = [];

async function listen(deps: McpServerDependencies) {
  const app = Fastify();
  apps.push(app);
  registerMcpServerRoutes(app, deps);
  await app.listen({ host: "127.0.0.1", port: 0 });
  const { port } = app.server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("published MCP server protocol", () => {
  it("echoes a supported requested protocol version and falls back to the latest", async () => {
    const requested = async (protocolVersion: unknown) => {
      const result = await handleMcpHttpRequest(dependencies(), {
        authorization: `Bearer ${TOKEN}`,
        parsedBody: {
          id: 1,
          jsonrpc: "2.0",
          method: "initialize",
          params: { protocolVersion },
        },
      });
      return (result.body as { result: { protocolVersion: string } }).result
        .protocolVersion;
    };
    expect(await requested("2025-06-18")).toBe("2025-06-18");
    expect(await requested("2025-11-25")).toBe("2025-11-25");
    expect(await requested("1999-01-01")).toBe("2025-11-25");
    expect(await requested(42)).toBe("2025-11-25");
  });

  it("rejects malformed request shapes without throwing", async () => {
    const cases: unknown[] = [
      { id: { nested: true }, jsonrpc: "2.0", method: "ping" },
      { id: [1], jsonrpc: "2.0", method: "ping" },
      { id: 1, jsonrpc: "2.0", method: "tools/call", params: ["array"] },
      { id: 1, jsonrpc: "2.0", method: "tools/call", params: "string" },
      { id: 1, jsonrpc: "1.0", method: "ping" },
      { id: 1, jsonrpc: "2.0", method: "" },
      [],
    ];
    for (const parsedBody of cases) {
      const result = await handleMcpHttpRequest(dependencies(), {
        authorization: `Bearer ${TOKEN}`,
        parsedBody,
      });
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({ error: expect.any(Object) });
    }
  });

  it("answers initialize, ping, tools/list, and tools/call over real HTTP", async () => {
    const origin = await listen(dependencies());
    const headers = {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
    };
    const initialize = await fetch(`${origin}/v1/mcp`, {
      body: JSON.stringify({
        id: 1,
        jsonrpc: "2.0",
        method: "initialize",
        params: { capabilities: {}, clientInfo: { name: "test", version: "1" }, protocolVersion: "2025-11-25" },
      }),
      headers,
      method: "POST",
    });
    expect(initialize.status).toBe(200);
    expect(initialize.headers.get("cache-control")).toContain("no-store");
    expect(await initialize.json()).toMatchObject({
      id: 1,
      result: {
        capabilities: { tools: { listChanged: false } },
        protocolVersion: "2025-11-25",
        serverInfo: { name: "talent-signal" },
      },
    });

    const ping = await fetch(`${origin}/v1/mcp`, {
      body: JSON.stringify({ id: 2, jsonrpc: "2.0", method: "ping" }),
      headers,
      method: "POST",
    });
    expect(await ping.json()).toMatchObject({ id: 2, result: {} });

    const list = await fetch(`${origin}/v1/mcp`, {
      body: JSON.stringify({ id: 3, jsonrpc: "2.0", method: "tools/list" }),
      headers,
      method: "POST",
    });
    expect(await list.json()).toMatchObject({
      result: {
        tools: [
          {
            annotations: { readOnlyHint: true },
            description: "talent_signal_workspace description",
            name: "talent_signal_workspace",
          },
        ],
      },
    });

    const call = await fetch(`${origin}/v1/mcp`, {
      body: JSON.stringify({
        id: 4,
        jsonrpc: "2.0",
        method: "tools/call",
        params: { arguments: {}, name: "talent_signal_workspace" },
      }),
      headers,
      method: "POST",
    });
    expect(await call.json()).toMatchObject({
      result: { isError: false, structuredContent: { ok: true } },
    });
  });

  it("round-trips with the bounded client handshake", async () => {
    const origin = await listen(dependencies());
    const target = await resolveMcpServerUrl(`${origin}/v1/mcp`, {
      allowedOrigins: [origin],
      resolver: async () => [{ address: "127.0.0.1", family: 4 }],
    });
    const result = await performMcpHandshake({
      bearerSecret: TOKEN,
      target,
    });
    expect(result.status).toBe("verified");
    expect(result.tools.map((discovered) => discovered.name)).toEqual([
      "talent_signal_workspace",
    ]);
  });

  it("requires its own bearer token and never accepts a missing one", async () => {
    const origin = await listen(dependencies());
    const response = await fetch(`${origin}/v1/mcp`, {
      body: JSON.stringify({ id: 1, jsonrpc: "2.0", method: "ping" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
    expect(await response.json()).toMatchObject({
      error: { code: -32001 },
      id: null,
    });
  });

  it("returns 405 for GET without a stream", async () => {
    const origin = await listen(dependencies());
    const response = await fetch(`${origin}/v1/mcp`, { method: "GET" });
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });

  it("filters tools by the grant scope and fails closed for denied calls", async () => {
    const origin = await listen(
      dependencies({
        resolveGrant: async () => ({
          accountId: "10000000-0000-4000-8000-000000000001",
          createdByUserId: "10000000-0000-4000-8000-000000000002",
          grantId: "10000000-0000-4000-8000-000000000003",
          name: "Workspace only",
          scopes: ["workspace_metadata_read"],
        }),
        tools: [
          tool("talent_signal_workspace", "workspace_metadata_read"),
          tool("talent_signal_people", "people_directory_read"),
        ],
      }),
    );
    const headers = {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
    };
    const list = await fetch(`${origin}/v1/mcp`, {
      body: JSON.stringify({ id: 1, jsonrpc: "2.0", method: "tools/list" }),
      headers,
      method: "POST",
    });
    const listed = (await list.json()) as { result: { tools: Array<{ name: string }> } };
    expect(listed.result.tools.map((item) => item.name)).toEqual([
      "talent_signal_workspace",
    ]);
    const denied = await fetch(`${origin}/v1/mcp`, {
      body: JSON.stringify({
        id: 2,
        jsonrpc: "2.0",
        method: "tools/call",
        params: { arguments: {}, name: "talent_signal_people" },
      }),
      headers,
      method: "POST",
    });
    expect(await denied.json()).toMatchObject({ error: { code: -32602 } });
  });

  it("rejects a non-configured browser Origin", async () => {
    const result = await handleMcpHttpRequest(dependencies(), {
      authorization: `Bearer ${TOKEN}`,
      origin: "https://hostile.example.test",
      parsedBody: { id: 1, jsonrpc: "2.0", method: "ping" },
    });
    expect(result.status).toBe(403);
  });

  it("accepts the configured public Origin and absent Origin", async () => {
    for (const origin of [PUBLIC_ORIGIN, undefined]) {
      const result = await handleMcpHttpRequest(dependencies(), {
        authorization: `Bearer ${TOKEN}`,
        origin,
        parsedBody: { id: 1, jsonrpc: "2.0", method: "ping" },
      });
      expect(result.status).toBe(200);
    }
  });

  it("returns JSON-RPC errors for unknown methods and invalid requests", async () => {
    const unknown = await handleMcpHttpRequest(dependencies(), {
      authorization: `Bearer ${TOKEN}`,
      parsedBody: { id: 9, jsonrpc: "2.0", method: "resources/list" },
    });
    expect(unknown.body).toMatchObject({ error: { code: -32601 } });
    const invalid = await handleMcpHttpRequest(dependencies(), {
      authorization: `Bearer ${TOKEN}`,
      parsedBody: { hello: "world" },
    });
    expect(invalid.body).toMatchObject({ error: { code: -32600 } });
  });

  it("rejects an unsupported MCP-Protocol-Version header on follow-up requests", async () => {
    const unsupported = await handleMcpHttpRequest(dependencies(), {
      authorization: `Bearer ${TOKEN}`,
      parsedBody: { id: 3, jsonrpc: "2.0", method: "tools/list" },
      protocolVersionHeader: "2024-11-05",
    });
    expect(unsupported).toMatchObject({ body: { error: { code: -32600 } }, status: 400 });
    const supported = await handleMcpHttpRequest(dependencies(), {
      authorization: `Bearer ${TOKEN}`,
      parsedBody: { id: 4, jsonrpc: "2.0", method: "tools/list" },
      protocolVersionHeader: "2025-11-25",
    });
    expect(supported.status).toBe(200);
  });

  it("acknowledges initialized notifications with no body", async () => {
    const result = await handleMcpHttpRequest(dependencies(), {
      authorization: `Bearer ${TOKEN}`,
      parsedBody: { jsonrpc: "2.0", method: "notifications/initialized" },
    });
    expect(result).toMatchObject({ body: null, status: 202 });
  });
});

describe("MCP tool registry projection", () => {
  it("exposes only read-only scoped tools and keeps contact handles out of projections", () => {
    const registry = createMcpToolRegistry({
      query: async () => ({ rows: [] }),
    } as never);
    expect(registry.map((item) => item.name)).toEqual([
      "talent_signal_workspace",
      "talent_signal_people",
    ]);
    expect(registry.every((item) => item.readOnly)).toBe(true);
  });
});

describe("complete bounded directory queries through the actual MCP registry", () => {
  function directory() {
    const queries: unknown[][] = [];
    const registry = createMcpToolRegistry({
      query: async (_sql: string, parameters: unknown[] = []) => {
        queries.push([...parameters]);
        return { rows: [] };
      },
    } as never);
    const app = Fastify(); apps.push(app);
    registerMcpServerRoutes(app, dependencies({ tools: registry }));
    const call = (query?: unknown, authorized = true) => app.inject({
      method: "POST", url: "/v1/mcp",
      headers: authorized ? { authorization: `Bearer ${TOKEN}` } : {},
      payload: { id: 1, jsonrpc: "2.0", method: "tools/call", params: {
        name: "talent_signal_people", arguments: query === undefined ? {} : { query },
      } },
    });
    return { call, queries, registry };
  }

  it("preserves different tails after character 160 without acquiring contact-handle matching", async () => {
    const { call, queries } = directory();
    const prefix = `Shared display name ${"a".repeat(160)}`;
    const complete = [`${prefix} first`, `${prefix} second`];
    expect(complete[0]!.slice(0, 160)).toBe(complete[1]!.slice(0, 160));
    for (const query of complete) {
      const response = await call(query);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ result: { isError: false, structuredContent: { people: [] } } });
    }
    // Actual listPeople SQL, not a fake tool callback. Handle type/hash remain
    // NULL: C16 must not switch this directory grant to searchPeople authority.
    expect(queries).toEqual(complete.map(query => [
      "10000000-0000-4000-8000-000000000001", query.toLowerCase(), null, null, null,
    ]));
  });

  it("passes an admitted long email as a complete literal name query, never a handle oracle", async () => {
    const { call, queries } = directory();
    const query = `reader.${"a".repeat(48)}@${"b".repeat(60)}.${"c".repeat(55)}.example.invalid`;
    expect(query.length).toBeGreaterThan(160);
    const response = await call(query);
    expect(response.json()).toMatchObject({ result: { isError: false } });
    expect(queries).toEqual([["10000000-0000-4000-8000-000000000001", query, null, null, null]]);
  });

  it("advertises and transports the complete 500-scalar input budget independently of result limits", async () => {
    const { call, queries, registry } = directory();
    const query = "😀".repeat(500);
    expect((await call(query)).json()).toMatchObject({ result: { isError: false } });
    expect(queries).toEqual([["10000000-0000-4000-8000-000000000001", query, null, null, null]]);
    const tool = registry.find(candidate => candidate.name === "talent_signal_people")!;
    expect(tool.inputSchema).toMatchObject({ properties: {
      query: { type: "string", maxLength: 500 }, limit: { maximum: 20 },
    } });
  });

  it.each([
    { label: "raw scalar limit", query: "a".repeat(501) },
    { label: "raw whitespace budget before trim", query: `${" ".repeat(500)}a` },
    { label: "normalized scalar limit", query: "ﬃ".repeat(170) },
    { label: "NUL", query: "reader\0tail" },
    { label: "unpaired surrogate", query: "reader\ud800tail" },
    { label: "provided nonstring", query: 42 },
  ])("explicitly refuses $label before any directory SQL", async ({ query }) => {
    const { call, queries } = directory();
    const response = await call(query);
    expect(response.statusCode).toBe(200);
    const body = response.json<{ error: { code: number; message: string } }>();
    expect(body).toMatchObject({ id: 1, jsonrpc: "2.0", error: { code: -32602 } });
    expect(body.error.message).toMatch(/query|search|input/i);
    expect(body.error.message).toMatch(/limit|long|invalid|unicode|supported/i);
    if (typeof query === "string") expect(body.error.message).not.toContain(query);
    expect(queries).toEqual([]);
  });

  it("keeps optional empty-directory semantics and authenticates before query errors", async () => {
    const { call, queries } = directory();
    expect((await call()).json()).toMatchObject({ result: { isError: false, structuredContent: { people: [] } } });
    expect(queries).toEqual([["10000000-0000-4000-8000-000000000001", "", null, null, null]]);
    queries.length = 0;
    const denied = await call("a".repeat(501), false);
    expect(denied.statusCode).toBe(401);
    expect(denied.json()).toMatchObject({ error: { code: -32001 } });
    expect(queries).toEqual([]);
  });
});
