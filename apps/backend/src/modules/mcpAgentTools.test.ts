import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import type { McpConnection } from "@talent-signal/contracts";
import { createWorkspaceMcpConnections } from "./mcpAgentTools.js";
import { listMcpConnections } from "./mcpConnections.js";
import { listMcpInteractions } from "./mcpInteractions.js";

vi.mock("./mcpConnections.js", async original => ({
  ...await original<typeof import("./mcpConnections.js")>(), listMcpConnections: vi.fn(),
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
