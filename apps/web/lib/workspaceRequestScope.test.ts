import { afterEach, describe, expect, it, vi } from "vitest";

import { workspaceSessionFetch } from "../components/workspace-session-request";

afterEach(() => vi.unstubAllGlobals());

describe("rendered workspace request scope", () => {
  function browser() {
    vi.stubGlobal("window", {
      location: { href: "http://localhost:3000/workspace/today", origin: "http://localhost:3000" },
    });
    vi.stubGlobal("document", {
      querySelector: () => ({ dataset: { workspaceScope: "rendered-account" } }),
    });
  }

  it("pins API writes to the rendered workspace and preserves request headers", async () => {
    browser();
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response("ok"));
    const original = new Request("http://localhost:3000/api/contacts", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    await workspaceSessionFetch(original, undefined, request);
    const sent = new Headers(request.mock.calls[0][1]?.headers);
    expect(sent.get("X-Talent-Signal-Workspace")).toBe("rendered-account");
    expect(sent.get("Content-Type")).toBe("application/json");
    expect(original.headers.has("X-Talent-Signal-Workspace")).toBe(false);
  });

  it("does not disclose workspace identity to an external origin", async () => {
    browser();
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response("ok"));
    await workspaceSessionFetch("https://example.com/api/upload", undefined, request);
    expect(new Headers(request.mock.calls[0][1]?.headers).has("X-Talent-Signal-Workspace")).toBe(false);
  });
});

it.each([undefined, "", " "])("does not send local API requests without a rendered scope: %s", async scope => {
  const browser = Object.assign(new EventTarget(), { location: { href: "https://example.test/contact-agent/people/person", origin: "https://example.test" } });
  vi.stubGlobal("window", browser);
  vi.stubGlobal("document", { querySelector: () => scope === undefined ? null : { dataset: { workspaceScope: scope } } });
  const expired = vi.fn();
  browser.addEventListener("talent-signal:workspace-session-expired", expired);
  const request = vi.fn<typeof fetch>();
  const response = await workspaceSessionFetch("/api/contact-agent/tasks", undefined, request);
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ code: "backend_session_expired" });
  expect(request).not.toHaveBeenCalled();
  expect(expired).toHaveBeenCalledOnce();
});

it("recovers canonical local credential loss without trusting a foreign 401", async () => {
  const browser = Object.assign(new EventTarget(), { location: { href: "https://product.test/workspace", origin: "https://product.test" } });
  vi.stubGlobal("window", browser);
  vi.stubGlobal("document", { querySelector: () => ({ dataset: { workspaceScope: "account" } }) });
  const expired = vi.fn();
  browser.addEventListener("talent-signal:workspace-session-expired", expired);
  const request = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ error: { code: "SESSION_INVALID" } }, { status: 401 }));
  const foreign = await workspaceSessionFetch("https://other.test/api/data", undefined, request);
  expect(foreign.status).toBe(401);
  expect(expired).not.toHaveBeenCalled();
  const local = await workspaceSessionFetch("/api/local-integration/people", undefined, request);
  expect(await local.json()).toEqual({ error: { code: "SESSION_INVALID" } });
  expect(expired).toHaveBeenCalledOnce();
});
