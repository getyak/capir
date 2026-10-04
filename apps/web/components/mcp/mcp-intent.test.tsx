import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { McpDirectoryPanel } from "./mcp-directory";
import { McpRequestCard } from "./mcp-request-card";
import { mcpIntentIdentity, workspaceIntentScope } from "./mcp-intent";

describe("MCP prerender and intent scope", () => {
  it("prerenders client components on the server without accessing document", () => {
    expect(typeof document).toBe("undefined");
    expect(workspaceIntentScope("session")).toBe('["session",""]');
    expect(renderToString(createElement(McpDirectoryPanel, { sessionVersion: "session" }))).toContain("连接常用服务");
    expect(renderToString(createElement(McpRequestCard, { requestId: "request", sessionVersion: "session" }))).toContain("正在读取最新状态");
  });
  it("binds exact input and owner scope without retaining plaintext in the identity", async () => {
    const identity = await mcpIntentIdentity("session-a", "request:revision-1", { secret: "fixture-secret" });
    expect(identity).toMatch(/^[a-f0-9]{64}$/);
    expect(identity).toBe(await mcpIntentIdentity("session-a", "request:revision-1", { secret: "fixture-secret" }));
    expect(identity).not.toBe(await mcpIntentIdentity("session-b", "request:revision-1", { secret: "fixture-secret" }));
    expect(identity).not.toBe(await mcpIntentIdentity("session-a", "request:revision-2", { secret: "fixture-secret" }));
    expect(identity).not.toBe(await mcpIntentIdentity("session-a", "request:revision-1", { secret: "different-fixture" }));
  });
});
