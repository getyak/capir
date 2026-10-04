import http from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { performMcpToolCall } from "./mcpClient.js";
import { resolveMcpServerUrl } from "./mcpSecurity.js";

/**
 * Real Streamable HTTP tool execution against a loopback synthetic MCP server:
 * initialize, notifications/initialized, tools/list and tools/call with the
 * negotiated session and protocol headers. No external service is contacted.
 */

interface Recorded {
  headers: http.IncomingHttpHeaders;
  method: string;
  body: Record<string, unknown>;
}

type Handler = (
  body: Record<string, unknown>,
  request: http.IncomingMessage,
  response: http.ServerResponse,
) => void;

const servers: http.Server[] = [];

async function syntheticServer(handler: Handler): Promise<{
  origin: string;
  calls: Recorded[];
  close: () => Promise<void>;
}> {
  const calls: Recorded[] = [];
  const server = http.createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
    calls.push({ body: parsed, headers: request.headers, method: request.method ?? "" });
    handler(parsed, request, response);
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

function json(response: http.ServerResponse, payload: unknown): void {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

function standardHandler(
  callResult: Record<string, unknown> | "error" | "hold",
): Handler {
  return (body, request, response) => {
    const method = body.method;
    if (method === "initialize") {
      response.writeHead(200, {
        "content-type": "application/json",
        "mcp-session-id": "synthetic-tool-session",
      });
      response.end(
        JSON.stringify({
          id: body.id,
          jsonrpc: "2.0",
          result: { capabilities: {}, protocolVersion: "2025-11-25", serverInfo: { name: "synthetic", version: "1" } },
        }),
      );
      return;
    }
    if (method === "notifications/initialized") {
      response.writeHead(202);
      response.end();
      return;
    }
    if (method === "tools/list") {
      json(response, {
        id: body.id,
        jsonrpc: "2.0",
        result: {
          tools: [
            {
              description: "Lookup",
              inputSchema: { properties: { query: { type: "string" } }, required: ["query"], type: "object" },
              name: "lookup",
            },
          ],
        },
      });
      return;
    }
    if (method === "tools/call") {
      if (callResult === "hold") return; // never respond: unreadable outcome
      if (callResult === "error") {
        json(response, {
          error: { code: -32000, message: "secret-echo remote failure" },
          id: body.id,
          jsonrpc: "2.0",
        });
        return;
      }
      json(response, { id: body.id, jsonrpc: "2.0", result: callResult });
      return;
    }
    void request;
    response.writeHead(500);
    response.end();
  };
}

async function targetFor(origin: string) {
  return resolveMcpServerUrl(`${origin}/mcp`, {
    allowedOrigins: [origin],
  });
}

afterAll(async () => {
  await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe("real MCP tools/call transport", () => {
  it("runs initialize, initialized, tools/list and tools/call with session headers", async () => {
    const server = await syntheticServer(
      standardHandler({ content: [{ text: "found 1", type: "text" }], isError: false }),
    );
    try {
      const result = await performMcpToolCall({
        arguments: { query: "hello" },
        target: await targetFor(server.origin),
        timeoutMs: 4_000,
        toolName: "lookup",
      });
      expect(result.status).toBe("succeeded");
      expect(result.isError).toBe(false);
      expect(result.effectSent).toBe(true);
      expect(result.protocolVersion).toBe("2025-11-25");
      expect(result.resultText).toContain("found 1");
      const methods = server.calls.map((call) => call.body.method);
      expect(methods).toEqual(["initialize", "notifications/initialized", "tools/list", "tools/call"]);
      const call = server.calls[3]!;
      expect(call.headers["mcp-session-id"]).toBe("synthetic-tool-session");
      expect(call.headers["mcp-protocol-version"]).toBe("2025-11-25");
      expect(call.body.params).toEqual({ arguments: { query: "hello" }, name: "lookup" });
    } finally {
      await server.close();
    }
  });

  it("distinguishes a tool isError result from transport failure", async () => {
    const server = await syntheticServer(
      standardHandler({ content: [{ text: "tool says no", type: "text" }], isError: true }),
    );
    try {
      const result = await performMcpToolCall({
        arguments: { query: "x" },
        target: await targetFor(server.origin),
        timeoutMs: 4_000,
        toolName: "lookup",
      });
      expect(result.status).toBe("failed");
      expect(result.isError).toBe(true);
      expect(result.jsonrpcError).toBe(false);
      expect(result.resultText).toContain("tool says no");
    } finally {
      await server.close();
    }
  });

  it("distinguishes a JSON-RPC error from a tool result", async () => {
    const server = await syntheticServer(standardHandler("error"));
    try {
      const result = await performMcpToolCall({
        arguments: { query: "x" },
        target: await targetFor(server.origin),
        timeoutMs: 4_000,
        toolName: "lookup",
      });
      expect(result.status).toBe("failed");
      expect(result.jsonrpcError).toBe(true);
      expect(result.isError).toBe(false);
    } finally {
      await server.close();
    }
  });

  it("reports an unreadable outcome after send as outcome_unknown, never a retryable failure", async () => {
    const server = await syntheticServer(standardHandler("hold"));
    try {
      const result = await performMcpToolCall({
        arguments: { query: "x" },
        target: await targetFor(server.origin),
        timeoutMs: 400,
        toolName: "lookup",
      });
      expect(result.status).toBe("outcome_unknown");
      expect(result.effectSent).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("refuses to send anything when the tool is not in the current directory", async () => {
    const server = await syntheticServer(standardHandler({ content: [] }));
    try {
      const result = await performMcpToolCall({
        arguments: { query: "x" },
        target: await targetFor(server.origin),
        timeoutMs: 4_000,
        toolName: "missing_tool",
      });
      expect(result.status).toBe("failed");
      expect(result.effectSent).toBe(false);
      expect(server.calls.some((call) => call.body.method === "tools/call")).toBe(false);
    } finally {
      await server.close();
    }
  });
});
