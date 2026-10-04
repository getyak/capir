import http from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { performMcpHandshake, MCP_ERROR_MESSAGES } from "./mcpClient.js";
import { resolveMcpServerUrl } from "./mcpSecurity.js";

const servers: http.Server[] = [];

async function syntheticServer(
  handler: http.RequestListener,
): Promise<{ origin: string; target: Awaited<ReturnType<typeof resolveMcpServerUrl>> }> {
  const server = http.createServer(handler);
  server.on("clientError", () => undefined);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${port}`;
  const target = await resolveMcpServerUrl(`${origin}/mcp`, {
    allowedOrigins: [origin],
    resolver: async () => [{ address: "127.0.0.1", family: 4 }],
  });
  return { origin, target };
}

async function requestBody(request: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function json(
  response: http.ServerResponse,
  body: unknown,
  status = 200,
): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
});

const initializeResult = {
  capabilities: {},
  protocolVersion: "2025-11-25",
  serverInfo: { name: "synthetic", version: "1" },
};

describe("MCP handshake over Streamable HTTP", () => {
  it("verifies JSON responses and records bounded tool discovery", async () => {
    let authorization: string | undefined;
    const { target } = await syntheticServer(async (request, response) => {
      const body = JSON.parse(await requestBody(request)) as {
        id?: number;
        method: string;
      };
      authorization = request.headers.authorization;
      if (body.method === "initialize") {
        response.setHeader("mcp-session-id", "synthetic-session");
        json(response, { id: body.id, jsonrpc: "2.0", result: initializeResult });
        return;
      }
      if (body.method === "notifications/initialized") {
        response.writeHead(202);
        response.end();
        return;
      }
      if (body.method === "tools/list") {
        expect(request.headers["mcp-session-id"]).toBe("synthetic-session");
        expect(request.headers["mcp-protocol-version"]).toBe("2025-11-25");
        json(response, {
          id: body.id,
          jsonrpc: "2.0",
          result: {
            tools: [
              {
                annotations: { readOnlyHint: true },
                description: "Synthetic read tool",
                inputSchema: { properties: {}, type: "object" },
                name: "alpha",
              },
              { description: "No annotation", name: "beta" },
            ],
          },
        });
        return;
      }
      json(response, { id: body.id, jsonrpc: "2.0", result: {} });
    });

    const result = await performMcpHandshake({
      bearerSecret: "synthetic-secret",
      target,
    });
    expect(authorization).toBe("Bearer synthetic-secret");
    expect(result.status).toBe("verified");
    expect(result.protocolVersion).toBe("2025-11-25");
    expect(result.tools).toEqual([
      {
        description: "Synthetic read tool",
        inputSchema: '{"properties":{},"type":"object"}',
        name: "alpha",
        read_only: true,
      },
      { description: "No annotation", inputSchema: null, name: "beta", read_only: false },
    ]);
  });

  it("accepts an SSE initialize response", async () => {
    const { target } = await syntheticServer(async (request, response) => {
      const body = JSON.parse(await requestBody(request)) as {
        id?: number;
        method: string;
      };
      response.on("error", () => undefined);
      if (body.method === "initialize") {
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.write(
          `event: message\ndata: ${JSON.stringify({
            id: body.id,
            jsonrpc: "2.0",
            result: initializeResult,
          })}\n\n`,
        );
        response.end();
        return;
      }
      if (body.method === "notifications/initialized") {
        response.writeHead(202);
        response.end();
        return;
      }
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(
        `data: ${JSON.stringify({
          id: body.id,
          jsonrpc: "2.0",
          result: { tools: [{ description: "sse", name: "sse_tool" }] },
        })}\n\n`,
      );
      response.end();
    });
    const result = await performMcpHandshake({ target });
    expect(result.status).toBe("verified");
    expect(result.tools[0]?.name).toBe("sse_tool");
  });

  it("pages tools/list with a bounded cursor", async () => {
    const { target } = await syntheticServer(async (request, response) => {
      const body = JSON.parse(await requestBody(request)) as {
        id?: number;
        method: string;
        params?: { cursor?: string };
      };
      if (body.method === "initialize") {
        json(response, { id: body.id, jsonrpc: "2.0", result: initializeResult });
        return;
      }
      if (body.method === "notifications/initialized") {
        response.writeHead(202);
        response.end();
        return;
      }
      const cursor = body.params?.cursor;
      json(response, {
        id: body.id,
        jsonrpc: "2.0",
        result: cursor
          ? { tools: [{ description: "second", name: "second_tool" }] }
          : {
              nextCursor: "page-2",
              tools: [{ description: "first", name: "first_tool" }],
            },
      });
    });
    const result = await performMcpHandshake({ target });
    expect(result.status).toBe("verified");
    expect(result.tools.map((tool) => tool.name)).toEqual([
      "first_tool",
      "second_tool",
    ]);
  });

  it("reports requires-auth on 401 without starting a login flow", async () => {
    const { target } = await syntheticServer((_request, response) => {
      response.writeHead(401, {
        "content-type": "application/json",
        "www-authenticate": "Bearer resource_metadata=\"https://id.example\"",
      });
      response.end("{}");
    });
    const result = await performMcpHandshake({ target });
    expect(result).toMatchObject({
      errorCode: "MCP_REQUIRES_AUTH",
      status: "unauthorized",
      tools: [],
    });
  });

  it("never returns a server-authored initialize error or echoed credential", async () => {
    const sentinel = "sentinel-secret-initialize-9f3";
    const { target } = await syntheticServer(async (request, response) => {
      const body = JSON.parse(await requestBody(request)) as { id?: number };
      json(response, {
        error: {
          code: -32000,
          message: `echo ${request.headers.authorization ?? ""} ${sentinel}`,
        },
        id: body.id,
        jsonrpc: "2.0",
      });
    });
    const result = await performMcpHandshake({ bearerSecret: sentinel, target });
    expect(result.errorCode).toBe("MCP_HANDSHAKE_FAILED");
    expect(result.errorMessage).toBe(MCP_ERROR_MESSAGES.MCP_HANDSHAKE_FAILED);
    expect(JSON.stringify(result)).not.toContain(sentinel);
  });

  it("never returns a server-authored tools/list error or echoed credential", async () => {
    const sentinel = "sentinel-secret-tools-4a1";
    const { target } = await syntheticServer(async (request, response) => {
      const body = JSON.parse(await requestBody(request)) as {
        id?: number;
        method: string;
      };
      if (body.method === "initialize") {
        json(response, { id: body.id, jsonrpc: "2.0", result: initializeResult });
        return;
      }
      if (body.method === "notifications/initialized") {
        response.writeHead(202);
        response.end();
        return;
      }
      json(response, {
        error: {
          code: -32603,
          message: `echo ${request.headers.authorization ?? ""} ${sentinel}`,
        },
        id: body.id,
        jsonrpc: "2.0",
      });
    });
    const result = await performMcpHandshake({ bearerSecret: sentinel, target });
    expect(result.errorCode).toBe("MCP_HANDSHAKE_FAILED");
    expect(result.errorMessage).toBe(MCP_ERROR_MESSAGES.MCP_HANDSHAKE_FAILED);
    expect(JSON.stringify(result)).not.toContain(sentinel);
  });

  it("refuses redirects", async () => {
    const { target } = await syntheticServer((_request, response) => {
      response.writeHead(302, { location: "https://evil.example/mcp" });
      response.end();
    });
    const result = await performMcpHandshake({ target });
    expect(result).toMatchObject({
      errorCode: "MCP_REDIRECT_REFUSED",
      status: "failed",
    });
  });

  it("times out a stalled server", async () => {
    const { target } = await syntheticServer((_request, response) => {
      setTimeout(() => {
        response.writeHead(200);
        response.end("{}");
      }, 2_000);
    });
    const result = await performMcpHandshake({ target, timeoutMs: 80 });
    expect(result).toMatchObject({ errorCode: "MCP_TIMEOUT", status: "failed" });
  });

  it("rejects an oversized response", async () => {
    const { target } = await syntheticServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.write('{"jsonrpc":"2.0","id":1,"result":{"padding":"');
      response.write("x".repeat(1_100_000));
      response.end('"}}');
    });
    const result = await performMcpHandshake({ target, timeoutMs: 2_000 });
    expect(result).toMatchObject({
      errorCode: "MCP_RESPONSE_TOO_LARGE",
      status: "failed",
    });
  });

  it("rejects an unparseable response", async () => {
    const { target } = await syntheticServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end("this is not json");
    });
    const result = await performMcpHandshake({ target });
    expect(result).toMatchObject({
      errorCode: "MCP_RESPONSE_INVALID",
      status: "failed",
    });
  });

  it("rejects an unsupported negotiated protocol version", async () => {
    const { target } = await syntheticServer(async (request, response) => {
      const body = JSON.parse(await requestBody(request)) as { id?: number };
      json(response, {
        id: body.id,
        jsonrpc: "2.0",
        result: { ...initializeResult, protocolVersion: "1999-01-01" },
      });
    });
    const result = await performMcpHandshake({ target });
    expect(result).toMatchObject({
      errorCode: "MCP_PROTOCOL_UNSUPPORTED",
      status: "failed",
    });
  });

  it("fails closed when a server advertises too many tools", async () => {
    const { target } = await syntheticServer(async (request, response) => {
      const body = JSON.parse(await requestBody(request)) as {
        id?: number;
        method: string;
      };
      if (body.method === "initialize") {
        json(response, { id: body.id, jsonrpc: "2.0", result: initializeResult });
        return;
      }
      if (body.method === "notifications/initialized") {
        response.writeHead(202);
        response.end();
        return;
      }
      json(response, {
        id: body.id,
        jsonrpc: "2.0",
        result: {
          tools: Array.from({ length: 101 }, (_value, index) => ({
            description: "",
            name: `tool_${index}`,
          })),
        },
      });
    });
    const result = await performMcpHandshake({ target });
    expect(result).toMatchObject({
      errorCode: "MCP_TOO_MANY_TOOLS",
      status: "failed",
    });
  });

  it("skips tools whose input schema exceeds the bound", async () => {
    const { target } = await syntheticServer(async (request, response) => {
      const body = JSON.parse(await requestBody(request)) as {
        id?: number;
        method: string;
      };
      if (body.method === "initialize") {
        json(response, { id: body.id, jsonrpc: "2.0", result: initializeResult });
        return;
      }
      if (body.method === "notifications/initialized") {
        response.writeHead(202);
        response.end();
        return;
      }
      json(response, {
        id: body.id,
        jsonrpc: "2.0",
        result: {
          tools: [
            { description: "small", name: "small" },
            {
              description: "huge",
              inputSchema: { padding: "x".repeat(25_000) },
              name: "huge",
            },
          ],
        },
      });
    });
    const result = await performMcpHandshake({ target });
    expect(result.status).toBe("verified");
    expect(result.tools.map((tool) => tool.name)).toEqual(["small"]);
  });
});
