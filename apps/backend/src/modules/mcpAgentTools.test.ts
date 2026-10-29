import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import type { McpConnection } from "@talent-signal/contracts";
import { createWorkspaceMcpConnections } from "./mcpAgentTools.js";
import { connectMcpConnection, listMcpConnections } from "./mcpConnections.js";
import { listMcpInteractions } from "./mcpInteractions.js";

vi.mock("./mcpConnections.js", async original => ({
  ...await original<typeof import("./mcpConnections.js")>(), listMcpConnections: vi.fn(), connectMcpConnection: vi.fn(),
}));
vi.mock("./mcpInteractions.js", async original => ({
  ...await original<typeof import("./mcpInteractions.js")>(), listMcpInteractions: vi.fn(),
}));

const connectionId = randomUUID();
const schema = { type: "object", properties: { prompt: { type: "string", description: "x".repeat(5000) } }, required: ["prompt"] };
const tools = Array.from({ length: 40 }, (_, index) => ({
  name: index === 39 ? "generate_image" : `lookup_${index}`,
  description: index === 39 ? "Create a synthetic picture" : "Lookup a row",
  input_schema: JSON.stringify(schema), read_only: index !== 39,
}));
const connection = { id: connectionId, friendly_name: "Synthetic MCP", status: "verified", revision: 4,
  auth_mode: "anonymous", server_url: "https://synthetic.example/mcp", tools, tools_count: tools.length } as McpConnection;
const auth = { accountId: randomUUID(), userId: randomUUID(), userEmail: "synthetic@example.invalid",
  accountSlug: "synthetic", sessionId: randomUUID(), userKind: "simulated_human" as const };
const adapter = () => createWorkspaceMcpConnections({ pool: {} as Pool, auth, sessionID: randomUUID(), messageID: randomUUID(), dependencies: {} });

describe("workspace MCP discovery projection", () => {
  beforeEach(() => {
    vi.mocked(listMcpConnections).mockResolvedValue({ contract_version: "talent-signal.v1", connections: [connection] } as never);
    vi.mocked(listMcpInteractions).mockResolvedValue({ requests: [] } as never);
  });

  it("loads only current account metadata through the production adapter snapshot", async () => {
    const current = adapter();
    expect(typeof current.snapshot).toBe("function");
    const snapshot = await current.snapshot!();
    expect(snapshot).toMatchObject({ state: "available", connection_count: 1, connections: [{ id: connectionId, status: "verified", revision: 4, tools_count: 40 }] });
    expect(JSON.stringify(snapshot)).not.toContain("x".repeat(100));
    expect(vi.mocked(listMcpConnections).mock.calls.at(-1)?.[1]).toBe(auth);
  });

  it("exposes bounded tool coverage and finds an image tool beyond the first page", async () => {
    const first = await adapter().handle({ operation: "list" });
    expect(first.data).toMatchObject({ connections: [{ tools_count: 40, tools_complete: false, next_tool_offset: 30 }] });
    expect(JSON.stringify(first)).not.toContain("x".repeat(5000));
    const found = await adapter().handle({ operation: "list", connection_id: connectionId, query: "picture" });
    expect(found.data).toMatchObject({ connections: [{ tools: [{ name: "generate_image" }], matched_tools_count: 1, tools_complete: true }] });
    const second = await adapter().handle({ operation: "list", connection_id: connectionId, tool_offset: 30 });
    expect(second.data).toMatchObject({ connections: [{ tools: expect.arrayContaining([expect.objectContaining({ name: "generate_image" })]), tools_complete: true }] });
  });

  it("reads one complete original schema without slicing it into invalid JSON", async () => {
    const result = await adapter().handle({ operation: "read_tool", connection_id: connectionId, tool_name: "generate_image" });
    expect(result.ok).toBe(true);
    const data = result.data as { tool: { input_schema: string }; connection_revision: number };
    expect(JSON.parse(data.tool.input_schema)).toEqual(schema);
    expect(data.connection_revision).toBe(4);
  });

  it("reports omitted tools after connecting and can page to the last tool", async () => {
    vi.mocked(connectMcpConnection).mockResolvedValue({ connection } as never);
    const current = adapter();
    const connected = await current.handle({ operation: "connect", connection_id: connectionId });
    expect(connected.data).toMatchObject({
      tools_count: 40, tools_complete: false, next_tool_offset: 30, connection_revision: 4,
    });
    expect((connected.data as { tools: unknown[] }).tools).toHaveLength(30);
    const remaining = await current.handle({ operation: "list", connection_id: connectionId,
      tool_offset: (connected.data as { next_tool_offset: number }).next_tool_offset });
    expect(remaining.data).toMatchObject({ connections: [{ tools_complete: true,
      tools: expect.arrayContaining([expect.objectContaining({ name: "generate_image" })]) }] });
  });

  it("preserves token and credential property schemas while redacting sensitive annotations", async () => {
    const original = { type: "object", properties: {
      max_tokens: { type: "integer", minimum: 1, enum: [128, 256] },
      api_key: { type: "string", default: "synthetic-private-default" },
      nested: { type: "object", properties: { secret: { type: "string", examples: ["private-example"] } } },
    }, required: ["max_tokens", "api_key"], additionalProperties: false };
    vi.mocked(listMcpConnections).mockResolvedValue({ connections: [{ ...connection,
      tools: [{ ...tools[0], input_schema: JSON.stringify(original) }] }] } as never);
    const result = await adapter().handle({ operation: "read_tool", connection_id: connectionId, tool_name: tools[0]!.name });
    expect(result.ok).toBe(true);
    expect(JSON.parse((result.data as { tool: { input_schema: string } }).tool.input_schema)).toEqual({
      ...original, properties: { ...original.properties,
        api_key: { type: "string", default: "[redacted]" },
        nested: { type: "object", properties: { secret: { type: "string", examples: ["[redacted]"] } } },
      },
    });
  });

  it.each(["{broken", "null", '"not a schema"'])("does not call an invalid schema complete: %s", async input_schema => {
    vi.mocked(listMcpConnections).mockResolvedValue({ connections: [{ ...connection,
      tools: [{ ...tools[0], input_schema }] }] } as never);
    expect(await adapter().handle({ operation: "read_tool", connection_id: connectionId, tool_name: tools[0]!.name }))
      .toMatchObject({ ok: false, error: { code: "MCP_TOOL_SCHEMA_UNAVAILABLE" } });
  });

  it("keeps definition names and references, including inert __proto__ properties", async () => {
    const original = JSON.parse('{"type":"object","properties":{"api_key":{"$ref":"#/$defs/credential"},"__proto__":{"type":"string"}},"$defs":{"credential":{"type":"string"}},"required":["api_key","__proto__"]}');
    vi.mocked(listMcpConnections).mockResolvedValue({ connections: [{ ...connection,
      tools: [{ ...tools[0], input_schema: JSON.stringify(original) }] }] } as never);
    const result = await adapter().handle({ operation: "read_tool", connection_id: connectionId, tool_name: tools[0]!.name });
    expect(result.ok).toBe(true);
    expect(JSON.parse((result.data as { tool: { input_schema: string } }).tool.input_schema)).toEqual(original);
  });

  it("refuses a sensitive literal constraint rather than inventing different valid arguments", async () => {
    vi.mocked(listMcpConnections).mockResolvedValue({ connections: [{ ...connection,
      tools: [{ ...tools[0], input_schema: JSON.stringify({ type: "object",
        properties: { api_key: { type: "string", const: "synthetic-private-literal" } } }) }] }] } as never);
    const result = await adapter().handle({ operation: "read_tool", connection_id: connectionId, tool_name: tools[0]!.name });
    expect(result).toMatchObject({ ok: false, error: { code: "MCP_TOOL_SCHEMA_UNAVAILABLE" } });
    expect(JSON.stringify(result)).not.toContain("synthetic-private-literal");
  });

  it.each(["accessToken", "clientSecret", "api_key"])("redacts all annotation shapes under %s", async field => {
    const original = { type: "object", properties: { [field]: { type: "string", description: "private-short-value",
      default: { value: "private-short-value" }, example: 123456, examples: [{ value: "private-short-value" }, 123456] } } };
    vi.mocked(listMcpConnections).mockResolvedValue({ connections: [{ ...connection,
      tools: [{ ...tools[0], input_schema: JSON.stringify(original) }] }] } as never);
    const result = await adapter().handle({ operation: "read_tool", connection_id: connectionId, tool_name: tools[0]!.name });
    expect(result.ok).toBe(true);
    const projected = JSON.parse((result.data as { tool: { input_schema: string } }).tool.input_schema);
    expect(projected.properties[field]).toEqual({ type: "string", description: "[redacted]", default: "[redacted]",
      example: "[redacted]", examples: ["[redacted]", "[redacted]"] });
    expect(JSON.stringify(result)).not.toContain("private-short-value");
    expect(JSON.stringify(result)).not.toContain("123456");
  });

  it.each([false, true])("propagates credential sensitivity through local references (literal=%s)", async literal => {
    const original = { type: "object", properties: { api_key: { $ref: "#/$defs/Value" } },
      $defs: { Value: { type: "string", ...(literal ? { const: "private-short-value" } : { default: "private-short-value" }) } } };
    vi.mocked(listMcpConnections).mockResolvedValue({ connections: [{ ...connection,
      tools: [{ ...tools[0], input_schema: JSON.stringify(original) }] }] } as never);
    const result = await adapter().handle({ operation: "read_tool", connection_id: connectionId, tool_name: tools[0]!.name });
    if (literal) expect(result).toMatchObject({ ok: false, error: { code: "MCP_TOOL_SCHEMA_UNAVAILABLE" } });
    else {
      expect(result.ok).toBe(true);
      expect(JSON.parse((result.data as { tool: { input_schema: string } }).tool.input_schema).$defs.Value)
        .toEqual({ type: "string", default: "[redacted]" });
    }
    expect(JSON.stringify(result)).not.toContain("private-short-value");
  });

  it("treats object-valued constraints as literal data and preserves safe values", async () => {
    const original = { type: "object", properties: { payload: { type: "object", const: { max_tokens: 128 },
      enum: [{ max_tokens: 128 }, { max_tokens: 256 }] } } };
    vi.mocked(listMcpConnections).mockResolvedValue({ connections: [{ ...connection,
      tools: [{ ...tools[0], input_schema: JSON.stringify(original) }] }] } as never);
    const result = await adapter().handle({ operation: "read_tool", connection_id: connectionId, tool_name: tools[0]!.name });
    expect(result.ok).toBe(true);
    expect(JSON.parse((result.data as { tool: { input_schema: string } }).tool.input_schema)).toEqual(original);
  });

  it.each(["const", "default"])("handles nested camelCase credentials in %s as data", async keyword => {
    const original = { type: "object", properties: { payload: { type: "object", additionalProperties: true,
      [keyword]: { accessToken: "private-short-value" } } } };
    vi.mocked(listMcpConnections).mockResolvedValue({ connections: [{ ...connection,
      tools: [{ ...tools[0], input_schema: JSON.stringify(original) }] }] } as never);
    const result = await adapter().handle({ operation: "read_tool", connection_id: connectionId, tool_name: tools[0]!.name });
    if (keyword === "const") expect(result).toMatchObject({ ok: false, error: { code: "MCP_TOOL_SCHEMA_UNAVAILABLE" } });
    else {
      expect(result.ok).toBe(true);
      expect(JSON.parse((result.data as { tool: { input_schema: string } }).tool.input_schema).properties.payload.default)
        .toEqual({ accessToken: "[redacted]" });
    }
    expect(JSON.stringify(result)).not.toContain("private-short-value");
  });

  it.each(["disconnected", "unauthorized", "failed"])("does not offer a cached schema as callable after %s", async status => {
    vi.mocked(listMcpConnections).mockResolvedValue({ connections: [{ ...connection, status }] } as never);
    expect(await adapter().handle({ operation: "read_tool", connection_id: connectionId, tool_name: "generate_image" }))
      .toMatchObject({ ok: false, error: { code: "MCP_CONNECTION_NOT_VERIFIED" } });
  });

  it("does not resolve a same-name tool from another account or connection", async () => {
    expect(await adapter().handle({ operation: "read_tool", connection_id: randomUUID(), tool_name: "generate_image" }))
      .toMatchObject({ ok: false, error: { code: "MCP_CALL_TARGET_NOT_FOUND" } });
    expect(vi.mocked(listMcpConnections).mock.calls.at(-1)?.[1]).toBe(auth);
  });
});
