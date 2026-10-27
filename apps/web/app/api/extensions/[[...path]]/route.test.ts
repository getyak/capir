import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { claims, snapshot } = vi.hoisted(() => ({
  claims: vi.fn(),
  snapshot: vi.fn(),
}));
vi.mock("@/lib/server/backendAuth", () => ({
  backendAuthBaseUrl: () => "http://127.0.0.1:4317",
  authSecret: () => "synthetic-test-secret",
  readBackendSessionClaims: claims,
}));
vi.mock("@/lib/server/mcpExtensions", () => ({
  loadMcpExtensionSnapshot: snapshot,
}));

import { contactHandoffSessionVersion } from "@/lib/server/contact-handoff-session";
import { GET, POST, PUT } from "./route";

const identity = {
  backendAccessToken: "synthetic-owner-token",
  backendAccountId: "synthetic-account",
  backendExpiresAt: "2099-01-01T00:00:00Z",
  backendUserId: "synthetic-user",
};
const upstream = vi.fn();

function context(path: string[]) {
  return { params: Promise.resolve({ path }) };
}

function request(
  method: "GET" | "POST" | "PUT",
  path: string,
  options: { body?: string; binding?: string | null; origin?: string | null } = {},
) {
  const headers = new Headers({
    host: "localhost:3000",
    "x-workspace-session":
      options.binding === undefined
        ? contactHandoffSessionVersion(identity as never)
        : (options.binding ?? ""),
  });
  if (options.origin !== null) headers.set("origin", options.origin ?? "http://localhost:3000");
  if (options.body) headers.set("content-type", "application/json");
  return new NextRequest(`http://localhost:3000/api/extensions${path}`, {
    body: options.body,
    headers,
    method,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", upstream);
  claims.mockResolvedValue(identity);
});
afterEach(() => vi.unstubAllGlobals());

it("relays only bound raster receipt images and rejects invalid indices", async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  upstream.mockResolvedValue(new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } }));
  const response = await GET(request("GET", `/tool-calls/${id}/images/0`), context(["tool-calls", id, "images", "0"]));
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("image/png");
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]));
  expect((await GET(request("GET", `/tool-calls/${id}/images/4`), context(["tool-calls", id, "images", "4"]))).status).toBe(404);
  expect((await GET(request("GET", `/tool-calls/${id}/images/0`, { binding: "stale" }), context(["tool-calls", id, "images", "0"]))).status).toBe(409);
});

it.each([["en", "Invalid image format."], ["zh-CN", "图片格式无效。"]])("localizes invalid-image diagnostics without widening the proxy: %s", async (locale, message) => {
  const id = "11111111-1111-4111-8111-111111111111";
  const input = request("GET", `/tool-calls/${id}/images/0`);
  input.headers.set("accept-language", locale);
  upstream.mockResolvedValue(new Response("not-raster", { headers: { "content-type": "image/svg+xml" } }));
  const result = await GET(input, context(["tool-calls", id, "images", "0"]));
  expect(result.status).toBe(502);
  expect(result.headers.get("cache-control")).toBe("no-store");
  expect(await result.json()).toEqual({ message });
  expect(upstream).toHaveBeenCalledOnce();
  expect(upstream.mock.calls[0]?.[0]).toBe(`http://127.0.0.1:4317/v1/mcp/tool-calls/${id}/images/0`);
});

it.each([["en", "The image is too large."], ["ja", "画像が大きすぎます。"]])("retains the raster byte cap with localized diagnostics: %s", async (locale, message) => {
  const id = "11111111-1111-4111-8111-111111111111";
  const input = request("GET", `/tool-calls/${id}/images/0`);
  input.headers.set("accept-language", locale);
  upstream.mockResolvedValue(new Response(new Uint8Array(750_001), { headers: { "content-type": "image/png" } }));
  const result = await GET(input, context(["tool-calls", id, "images", "0"]));
  expect(result.status).toBe(502);
  expect(await result.json()).toEqual({ message });
  expect(upstream).toHaveBeenCalledOnce();
  expect(upstream.mock.calls[0]?.[1].signal.aborted).toBe(true);
});

it("requires authenticated workspace identity before any read or write", async () => {
  claims.mockResolvedValue(null);
  expect((await GET(request("GET", ""), context([]))).status).toBe(401);
  expect(
    (await POST(request("POST", "/connections", { body: "{}" }), context(["connections"])))
      .status,
  ).toBe(401);
  expect(upstream).not.toHaveBeenCalled();
  expect(snapshot).not.toHaveBeenCalled();
});

it("rejects cross-origin mutations before forwarding a workspace credential", async () => {
  const response = await POST(
    request("POST", "/clients", { body: "{}", origin: "https://hostile.invalid" }),
    context(["clients"]),
  );
  expect(response.status).toBe(403);
  expect(upstream).not.toHaveBeenCalled();
});

it("rejects a stale workspace binding", async () => {
  claims.mockResolvedValue({ ...identity, backendAccessToken: "replaced-login" });
  const response = await GET(request("GET", ""), context([]));
  expect(response.status).toBe(409);
  expect((await response.json()).code).toBe("session_stale");
  expect(snapshot).not.toHaveBeenCalled();
});

it("serves the bounded snapshot only through authenticated GET", async () => {
  snapshot.mockResolvedValue({
    connections: [{ id: "connection-a" }],
    endpoints: { configured: false },
    grants: [],
  });
  const response = await GET(request("GET", ""), context([]));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toMatchObject({
    connections: [{ id: "connection-a" }],
  });
});

it("forwards only allowlisted backend paths with the owner token", async () => {
  upstream.mockResolvedValue(
    new Response(JSON.stringify({ connections: [] }), {
      headers: { "content-type": "application/json" },
      status: 200,
    }),
  );
  const response = await GET(request("GET", "/connections"), context(["connections"]));
  expect(response.status).toBe(200);
  expect(upstream).toHaveBeenCalledWith(
    "http://127.0.0.1:4317/v1/mcp/connections",
    expect.objectContaining({
      cache: "no-store",
      headers: { accept: "application/json", authorization: "Bearer synthetic-owner-token" },
      method: "GET",
    }),
  );
});

it("allows the narrowed connection update route over PUT", async () => {
  const id = "10000000-0000-4000-8000-000000000001";
  upstream.mockResolvedValue(
    new Response(JSON.stringify({ connection: { id } }), {
      headers: { "content-type": "application/json" },
      status: 200,
    }),
  );
  const response = await PUT(
    request("PUT", `/connections/${id}`, {
      body: JSON.stringify({ expected_revision: 1, friendly_name: "x", server_url: "https://mcp.example.com/mcp" }),
    }),
    context(["connections", id]),
  );
  expect(response.status).toBe(200);
  expect(upstream).toHaveBeenCalledWith(
    `http://127.0.0.1:4317/v1/mcp/connections/${id}`,
    expect.objectContaining({ method: "PUT" }),
  );
  // PUT is not allowlisted for any other collection.
  upstream.mockClear();
  expect(
    (await PUT(request("PUT", "/clients", { body: "{}" }), context(["clients"])))
      .status,
  ).toBe(404);
  expect(upstream).not.toHaveBeenCalled();
});

it("answers 408 for a stalled request body instead of hanging", async () => {
  vi.useFakeTimers();
  try {
    const stalled = new ReadableStream<Uint8Array>({ start() {} });
    const fake = {
      body: stalled,
      headers: new Headers({
        host: "localhost:3000",
        origin: "http://localhost:3000",
        "x-workspace-session": contactHandoffSessionVersion(identity as never),
      }),
      method: "POST",
      signal: new AbortController().signal,
    } as unknown as NextRequest;
    const pending = POST(fake, context(["connections"]));
    await vi.advanceTimersByTimeAsync(11_000);
    const response = await pending;
    expect(response.status).toBe(408);
    expect(upstream).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

it("rejects unknown or malformed extension routes", async () => {
  expect((await GET(request("GET", "/secrets"), context(["secrets"]))).status).toBe(404);
  expect(
    (await GET(request("GET", "/connections/not-a-uuid"), context(["connections", "not-a-uuid"])))
      .status,
  ).toBe(404);
  expect(
    (await POST(request("POST", "/connections/x/connect", { body: "{}" }), context(["connections", "x", "connect"])))
      .status,
  ).toBe(404);
  expect(upstream).not.toHaveBeenCalled();
});

it("bounds mutation bodies before contacting the backend", async () => {
  const response = await POST(
    request("POST", "/connections", { body: JSON.stringify({ padding: "x".repeat(70_000) }) }),
    context(["connections"]),
  );
  expect(response.status).toBe(413);
  expect(upstream).not.toHaveBeenCalled();
});

it("relays a backend rejection without inventing success", async () => {
  upstream.mockResolvedValue(
    new Response(JSON.stringify({ error: { code: "MCP_ENDPOINT_REJECTED", message: "nope" } }), {
      headers: { "content-type": "application/json" },
      status: 400,
    }),
  );
  const response = await POST(
    request("POST", "/connections", { body: JSON.stringify({ friendly_name: "x" }) }),
    context(["connections"]),
  );
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { code: "MCP_ENDPOINT_REJECTED" } });
});

it("reports a bounded upstream timeout truthfully", async () => {
  const aborted = Object.assign(new Error("aborted"), { name: "AbortError" });
  snapshot.mockRejectedValue(aborted);
  const response = await GET(request("GET", ""), context([]));
  expect(response.status).toBe(504);
});
