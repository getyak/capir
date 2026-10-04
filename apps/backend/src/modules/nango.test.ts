import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  createNangoConnectSession,
  listNangoConnectionsByTag,
  loadNangoConfig,
  nangoProxyPost,
  parseNangoAuthWebhook,
  verifyNangoWebhookSignature,
  type NangoConfig,
} from "./nango.js";

const config: NangoConfig = {
  apiKey: "test-api-key",
  baseUrl: "https://api.nango.dev",
  environment: "DEV",
  webhookSigningKey: "test-webhook-signing-key",
};

function stubFetcher(
  handler: (url: string, init: RequestInit) => { status: number; body: unknown } | null,
): { fetcher: typeof fetch; seen: Array<{ url: string; init: RequestInit }> } {
  const seen: Array<{ url: string; init: RequestInit }> = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    seen.push({ init: init ?? {}, url });
    const result = handler(url, init ?? {});
    if (!result) throw new Error("network down");
    return new Response(JSON.stringify(result.body), {
      headers: { "content-type": "application/json" },
      status: result.status,
    });
  }) as typeof fetch;
  return { fetcher, seen };
}

describe("optional Nango configuration", () => {
  it("is explicitly unavailable when keys are absent", () => {
    expect(loadNangoConfig({})).toBeNull();
    expect(loadNangoConfig({ NANGO_API_KEY: "only-one" })).toBeNull();
    expect(
      loadNangoConfig({ NANGO_API_KEY: "a", NANGO_WEBHOOK_SIGNING_KEY: "b" }),
    ).toMatchObject({ baseUrl: "https://api.nango.dev" });
  });

  it("rejects a non-origin base URL instead of following it", () => {
    expect(() =>
      loadNangoConfig({
        NANGO_API_KEY: "a",
        NANGO_BASE_URL: "https://api.nango.dev/evil/path",
        NANGO_WEBHOOK_SIGNING_KEY: "b",
      }),
    ).toThrow();
  });
});

describe("Nango connect session binding", () => {
  it("binds the server-generated request id, identities and approved URL", async () => {
    const { fetcher, seen } = stubFetcher((url, init) => {
      if (url.endsWith("/connect/sessions")) {
        return {
          body: { data: { connect_link: "https://app.nango.dev/connect/x", expires_at: "2030-01-01T00:00:00Z", token: "session-token-123" } },
          status: 201,
        };
      }
      void init;
      return null;
    });
    const session = await createNangoConnectSession(
      config,
      {
        accountId: "account-1",
        connectRequestId: "mcpconn_abc123",
        provider: "notion-mcp",
        sessionId: "session-1",
        serverUrl: "https://mcp.notion.com",
        userId: "user-1",
      },
      fetcher,
    );
    expect(session.token).toBe("session-token-123");
    const body = JSON.parse(String(seen[0]!.init.body)) as {
      allowed_integrations: string[];
      tags: Record<string, string>;
      integrations_config_defaults: Record<string, { connection_config: Record<string, string> }>;
    };
    expect(body.allowed_integrations).toEqual(["notion-mcp"]);
    expect(body.tags).toMatchObject({
      connect_request_id: "mcpconn_abc123",
      account_id: "account-1",
      user_id: "user-1",
      session_id: "session-1",
      mcp_server_url: "https://mcp.notion.com",
      provider: "notion-mcp",
    });
    expect(body.integrations_config_defaults["notion-mcp"]?.connection_config).toEqual({
      mcp_server_url: "https://mcp.notion.com",
    });
  });
});

describe("raw-body webhook verification", () => {
  it("accepts only an HMAC of the exact raw body", () => {
    const raw = JSON.stringify({ type: "auth", operation: "creation" });
    const signature = createHmac("sha256", config.webhookSigningKey).update(raw).digest("hex");
    expect(verifyNangoWebhookSignature(config, raw, signature)).toBe(true);
    expect(verifyNangoWebhookSignature(config, `${raw} `, signature)).toBe(false);
    expect(verifyNangoWebhookSignature(config, raw, "not-hex-signature-value")).toBe(false);
    expect(verifyNangoWebhookSignature(config, raw, undefined)).toBe(false);
  });

  it("parses auth events strictly and ignores anything else", () => {
    const parsed = parseNangoAuthWebhook(
      JSON.stringify({
        type: "auth",
        operation: "creation",
        connectionId: "conn-1",
        authMode: "OAUTH2",
        providerConfigKey: "notion-mcp",
        provider: "notion",
        environment: "DEV",
        success: true,
        tags: { Connect_Request_ID: "mcpconn_abc123" },
      }),
    );
    expect(parsed).toMatchObject({
      connectionId: "conn-1",
      operation: "creation",
      tags: { connect_request_id: "mcpconn_abc123" },
      type: "auth",
    });
    expect(parseNangoAuthWebhook(JSON.stringify({ type: "sync" }))).toBeNull();
    expect(parseNangoAuthWebhook("not json")).toBeNull();
  });
});

describe("credential-free metadata readback and frozen proxy", () => {
  it("discovers connections only by the bound server-generated tag", async () => {
    // The production GET /connections envelope is `{ "connections": [...] }`
    // with a `created` field; this shape is taken from the deployed runtime,
    // not invented.
    const { fetcher, seen } = stubFetcher(() => ({
      body: {
        connections: [
          {
            connection_id: "conn-9",
            created: "2026-10-04T00:00:00.000Z",
            provider_config_key: "notion-mcp",
            tags: { connect_request_id: "mcpconn_abc123", mcp_server_url: "https://mcp.notion.com/mcp" },
          },
        ],
      },
      status: 200,
    }));
    const entries = await listNangoConnectionsByTag(
      config,
      { connect_request_id: "mcpconn_abc123" },
      fetcher,
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      connectionId: "conn-9",
      createdAt: "2026-10-04T00:00:00.000Z",
      providerConfigKey: "notion-mcp",
    });
    expect(JSON.stringify(entries[0])).not.toMatch(/credential|token|secret/iu);
    const url = new URL(seen[0]!.url);
    expect(url.pathname).toBe("/connections");
    expect(url.searchParams.get("tags[connect_request_id]")).toBe("mcpconn_abc123");
  });

  it("fails closed on an unsupported envelope instead of trusting it", async () => {
    for (const body of [
      { data: [{ connection_id: "conn-1" }] },
      { connections: { not: "an array" } },
      { something_else: [] },
      "not an object",
    ]) {
      const { fetcher } = stubFetcher(() => ({ body, status: 200 }));
      const entries = await listNangoConnectionsByTag(
        config,
        { connect_request_id: "mcpconn_abc123" },
        fetcher,
      );
      expect(entries).toEqual([]);
    }
  });

  it("keeps POST, header, frozen target and zero-retry semantics in the proxy", async () => {
    const { fetcher, seen } = stubFetcher(() => ({
      body: { id: 1, jsonrpc: "2.0", result: { content: [] } },
      status: 200,
    }));
    const response = await nangoProxyPost(
      config,
      {
        body: "{}",
        connectionId: "conn-9",
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
          "mcp-session-id": "sess",
          "x-evil-header": "nope",
        },
        path: "/mcp",
        providerConfigKey: "notion-mcp",
        targetOrigin: "https://mcp.notion.com",
        timeoutMs: 4_000,
      },
      fetcher,
    );
    expect(response.status).toBe(200);
    const request = seen[0]!;
    expect(String(request.url)).toBe("https://api.nango.dev/proxy/mcp");
    const headers = request.init.headers as Record<string, string>;
    expect(headers["retries"]).toBe("0");
    expect(headers["base-url-override"]).toBe("https://mcp.notion.com");
    expect(headers["connection-id"]).toBe("conn-9");
    expect(headers["provider-config-key"]).toBe("notion-mcp");
    expect(headers["nango-proxy-content-type"]).toBe("application/json");
    expect(headers["nango-proxy-mcp-session-id"]).toBe("sess");
    expect(headers["x-evil-header"]).toBeUndefined();
  });

  it("refuses an arbitrary proxy path", async () => {
    const { fetcher } = stubFetcher(() => ({ body: {}, status: 200 }));
    await expect(
      nangoProxyPost(
        config,
        {
          body: "{}",
          connectionId: "c",
          headers: {},
          path: "/../../etc/passwd",
          providerConfigKey: "p",
          targetOrigin: "https://mcp.notion.com",
          timeoutMs: 1_000,
        },
        fetcher,
      ),
    ).rejects.toMatchObject({ code: "MCP_OAUTH_UNAVAILABLE" });
  });
});
