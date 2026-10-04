// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { McpInteractionRequest, McpToolCallReceipt } from "@talent-signal/contracts";

import { McpRequestCard } from "./mcp-request-card";

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const CALL_ID = "22222222-2222-4222-8222-222222222222";
const SESSION_VERSION = "workspace-session-binding-v1";

const fetcher = vi.hoisted(() => vi.fn());

function request(overrides: Partial<McpInteractionRequest> = {}): McpInteractionRequest {
  return {
    arguments_display: '{\n  "query": "hello"\n}',
    argument_schema: '{"type":"object"}',
    call_id: CALL_ID,
    choices: [],
    created_at: "2026-10-04T00:00:00.000Z",
    expires_at: "2030-01-01T00:00:00.000Z",
    id: REQUEST_ID,
    kind: "approval",
    message_id: null,
    oauth: null,
    purpose: "Answer with one lookup.",
    receipt: null,
    resolved_at: null,
    revision: 3,
    schema_unsupported_reason: null,
    session_id: null,
    state: "pending",
    target: {
      auth_mode: "anonymous",
      connection_id: "33333333-3333-4333-8333-333333333333",
      connection_label: "Context7",
      server_origin: "https://mcp.context7.com",
      tool_name: "lookup",
    },
    updated_at: "2026-10-04T00:00:00.000Z",
    ...overrides,
  };
}

let mount: HTMLDivElement;
let root: Root;

async function flush() {
  await act(async () => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  });
}

function text() {
  return mount.textContent ?? "";
}

function button(label: string): HTMLButtonElement {
  const found = [...mount.querySelectorAll("button")].find((item) => item.textContent === label);
  if (!found) throw new Error(`button not found: ${label}`);
  return found;
}

function sessionHeaderOf(call: unknown[]): string | null {
  const init = call[1] as RequestInit | undefined;
  return new Headers(init?.headers ?? {}).get("x-workspace-session");
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mount = document.createElement("div");
  document.body.appendChild(mount);
  root = createRoot(mount);
  // The workspace scope marker is what authorizes same-origin scoped calls.
  const scope = document.createElement("div");
  scope.setAttribute("data-workspace-scope", "account-scope-token");
  document.body.appendChild(scope);
  vi.stubGlobal("fetch", fetcher);
  fetcher.mockReset();
});

afterEach(async () => {
  await act(async () => root.unmount());
  mount.remove();
  document.body.querySelector("[data-workspace-scope]")?.remove();
  vi.unstubAllGlobals();
});

describe("McpRequestCard", () => {
  it("sends the canonical workspace session header on read and resolve", async () => {
    fetcher.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/resolve")) {
        return new Response(JSON.stringify({ request: request({ state: "submitted" }) }), { status: 200 });
      }
      void init;
      return new Response(JSON.stringify({ request: request() }), { status: 200 });
    });
    await act(async () => {
      root.render(
        createElement(McpRequestCard, { requestId: REQUEST_ID, sessionVersion: SESSION_VERSION }),
      );
    });
    await flush();
    expect(text()).toContain("工具调用确认");
    expect(text()).toContain("等待确认");
    for (const call of fetcher.mock.calls) {
      expect(sessionHeaderOf(call)).toBe(SESSION_VERSION);
    }
    await act(async () => button("确认执行").click());
    await flush();
    const resolveCall = fetcher.mock.calls.find((call) => String(call[0]).includes("/resolve"))!;
    expect(sessionHeaderOf(resolveCall)).toBe(SESSION_VERSION);
    const body = JSON.parse(String((resolveCall[1] as RequestInit).body)) as Record<string, unknown>;
    expect(body).toMatchObject({ action: "approve", expected_revision: 3 });
    // One stable key per intent: bounded and revision-scoped.
    expect(String(body.idempotency_key)).toMatch(/^web-resolve-[a-f0-9-]+$/);
    expect(String(body.idempotency_key).length).toBeLessThanOrEqual(128);
    expect(text()).toContain("已确认");
  });

  it("keeps the secret transient, clears it in finally, and never echoes it on reads", async () => {
    fetcher.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/resolve")) {
        return new Response(JSON.stringify({ request: request({ kind: "secret", state: "submitted" }) }), { status: 200 });
      }
      return new Response(
        JSON.stringify({ request: request({ kind: "secret", arguments_display: '{"friendly_name":"Private"}' }) }),
        { status: 200 },
      );
    });
    await act(async () => {
      root.render(
        createElement(McpRequestCard, { requestId: REQUEST_ID, sessionVersion: SESSION_VERSION }),
      );
    });
    await flush();
    const input = mount.querySelector('input[type="password"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    // Honest copy: the encrypted connection credential is stored for later
    // calls; the plaintext secret itself is never stored or shown to a model.
    expect(text()).toContain("加密后的凭据");
    expect(text()).toContain("模型和对话内容永远不会看到它");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "tsuper-secret-1");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => button("确认并连接").click());
    await flush();
    const payloads = fetcher.mock.calls
      .filter((call) => String(call[0]).includes("/resolve"))
      .map((call) => String((call[1] as RequestInit).body));
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toContain("tsuper-secret-1");
    for (const call of fetcher.mock.calls.filter((item) => !String(item[0]).includes("/resolve"))) {
      expect(JSON.stringify(call)).not.toContain("tsuper-secret-1");
    }
    expect((mount.querySelector('input[type="password"]') as HTMLInputElement | null)?.value ?? "").toBe("");
  });

  it("clears the secret even when the network throws", async () => {
    fetcher.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes("/resolve")) throw new Error("network down");
      return new Response(
        JSON.stringify({ request: request({ kind: "secret", arguments_display: '{"friendly_name":"Private"}' }) }),
        { status: 200 },
      );
    });
    await act(async () => {
      root.render(
        createElement(McpRequestCard, { requestId: REQUEST_ID, sessionVersion: SESSION_VERSION }),
      );
    });
    await flush();
    const input = mount.querySelector('input[type="password"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "tsuper-secret-2");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => button("确认并连接").click());
    await flush();
    expect((mount.querySelector('input[type="password"]') as HTMLInputElement | null)?.value ?? "").toBe("");
    expect(text()).toContain("网络异常");
  });

  it("submits a choice and labels settled states without decision actions", async () => {
    fetcher.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/resolve")) {
        return new Response(JSON.stringify({ request: request({ kind: "choice", state: "submitted" }) }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          request: request({
            choices: [
              { id: "anonymous", label: "No sign-in" },
              { id: "bearer", label: "API token" },
            ],
            kind: "choice",
          }),
        }),
        { status: 200 },
      );
    });
    await act(async () => {
      root.render(
        createElement(McpRequestCard, { requestId: REQUEST_ID, sessionVersion: SESSION_VERSION }),
      );
    });
    await flush();
    await act(async () => button("API token").click());
    await flush();
    const body = JSON.parse(
      String((fetcher.mock.calls.find((call) => String(call[0]).includes("/resolve"))![1] as RequestInit).body),
    ) as Record<string, unknown>;
    expect(body).toMatchObject({ action: "submit", choice_id: "bearer" });
    expect([...mount.querySelectorAll("button")].map((item) => item.textContent)).toEqual(["刷新状态"]);
  });

  it("polls the canonical poll route for a waiting OAuth request and stops at terminal", async () => {
    vi.useFakeTimers();
    let polls = 0;
    let state: McpInteractionRequest["state"] = "waiting";
    fetcher.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/oauth/poll/")) {
        polls += 1;
        if (polls >= 2) state = "submitted";
        return new Response(JSON.stringify({ request: request({ kind: "oauth", state }) }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          request: request({
            kind: "oauth",
            oauth: {
              available: true,
              connect_request_id: "mcpconn_abc123",
              connect_url: "https://connect.example.test/ui",
              provider: "notion-mcp",
            },
            state,
          }),
        }),
        { status: 200 },
      );
    });
    await act(async () => {
      root.render(
        createElement(McpRequestCard, { requestId: REQUEST_ID, sessionVersion: SESSION_VERSION }),
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000);
    });
    const pollsMade = fetcher.mock.calls.filter((call) => String(call[0]).includes("/oauth/poll/mcpconn_abc123"));
    expect(pollsMade.length).toBeGreaterThan(0);
    for (const call of pollsMade) expect(sessionHeaderOf(call)).toBe(SESSION_VERSION);
    // Terminal after the second poll: polling stops and the card settled.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    const after = fetcher.mock.calls.filter((call) => String(call[0]).includes("/oauth/poll/")).length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(fetcher.mock.calls.filter((call) => String(call[0]).includes("/oauth/poll/")).length).toBe(after);
    vi.useRealTimers();
  });

  it("shows an explicit OAuth-unavailable state with no fake success", async () => {
    fetcher.mockImplementation(async () =>
      new Response(
        JSON.stringify({
          request: request({
            kind: "oauth",
            oauth: {
              available: false,
              connect_request_id: "mcpconn_abc123",
              connect_url: null,
              provider: "notion-mcp",
            },
          }),
        }),
        { status: 200 },
      ),
    );
    await act(async () => {
      root.render(
        createElement(McpRequestCard, { requestId: REQUEST_ID, sessionVersion: SESSION_VERSION }),
      );
    });
    await flush();
    expect(text()).toContain("尚未配置 OAuth");
    expect(mount.querySelector("a")).toBeNull();
  });

  it("disables decisions when the canonical read fails instead of trusting a fallback", async () => {
    fetcher.mockImplementation(async () => new Response("{}", { status: 409 }));
    await act(async () => {
      root.render(
        createElement(McpRequestCard, {
          fallback: { kind: "approval", purpose: "stale", state: "pending" },
          requestId: REQUEST_ID,
          sessionVersion: SESSION_VERSION,
        }),
      );
    });
    await flush();
    expect(text()).toContain("无法加载");
    // No decision button is clickable without the current canonical revision.
    expect([...mount.querySelectorAll("button")].map((item) => item.textContent)).toEqual(["刷新状态"]);
    expect(text()).toContain("stale");
  });

  it("labels an expired request and offers only refresh", async () => {
    fetcher.mockImplementation(async () =>
      new Response(JSON.stringify({ request: request({ state: "expired" }) }), { status: 200 }),
    );
    await act(async () => {
      root.render(
        createElement(McpRequestCard, {
          fallback: { kind: "approval", purpose: "stale", state: "pending" },
          requestId: REQUEST_ID,
          sessionVersion: SESSION_VERSION,
        }),
      );
    });
    await flush();
    expect(text()).toContain("已过期");
    expect([...mount.querySelectorAll("button")].map((item) => item.textContent)).toEqual(["刷新状态"]);
  });
  it("keeps a network retry key only for the same decision and changes it on rejection", async () => {
    fetcher.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes("/resolve")) throw new Error("network down");
      return new Response(JSON.stringify({ request: request() }), { status: 200 });
    });
    await act(async () => root.render(createElement(McpRequestCard, { requestId: REQUEST_ID, sessionVersion: SESSION_VERSION })));
    await flush();
    await act(async () => button("确认执行").click());
    await flush();
    await act(async () => button("确认执行").click());
    await flush();
    await act(async () => button("拒绝").click());
    await flush();
    const bodies = fetcher.mock.calls.filter((call) => String(call[0]).includes("/resolve")).map((call) => JSON.parse(String((call[1] as RequestInit).body)));
    expect(bodies[0].idempotency_key).toBe(bodies[1].idempotency_key);
    expect(bodies[2].idempotency_key).not.toBe(bodies[1].idempotency_key);
    expect(bodies[2].action).toBe("reject");
  });

  it("blocks externally disabled directory decisions even after a successful card read", async () => {
    fetcher.mockImplementation(async () => new Response(JSON.stringify({ request: request() }), { status: 200 }));
    await act(async () => root.render(createElement(McpRequestCard, { requestId: REQUEST_ID, sessionVersion: SESSION_VERSION, disabled: true })));
    await flush();
    expect(button("确认执行").disabled).toBe(true);
    expect(button("拒绝").disabled).toBe(true);
    await act(async () => button("确认执行").click());
    expect(fetcher.mock.calls.some((call) => String(call[0]).includes("/resolve"))).toBe(false);
  });

  it("clears plaintext when the authenticated scope changes", async () => {
    fetcher.mockImplementation(async () => new Response(JSON.stringify({ request: request({ kind: "secret" }) }), { status: 200 }));
    await act(async () => root.render(createElement(McpRequestCard, { requestId: REQUEST_ID, sessionVersion: SESSION_VERSION })));
    await flush();
    const field = mount.querySelector('input[type="password"]') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "private-first-user");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(field.value).toBe("private-first-user");
    await act(async () => root.render(createElement(McpRequestCard, { requestId: REQUEST_ID, sessionVersion: "other-user-session" })));
    await flush();
    expect((mount.querySelector('input[type="password"]') as HTMLInputElement).value).toBe("");
    expect(fetcher.mock.calls.some((call) => String(call[0]).includes("/resolve"))).toBe(false);
  });

  it.each([
    [JSON.stringify({ content: [{ type: "text", text: "React repository\n1. Architecture" }, { type: "text", text: "2. Hooks" }] }), "React repository\n1. Architecture\n\n2. Hooks"],
    ["Plain service error\nRetry later", "Plain service error\nRetry later"],
    ['{"content": broken', '{"content": broken'],
    [JSON.stringify({ content: [{ type: "text", text: '<script>window.evil = true</script>\n<img src=x onerror=evil()>' }] }), '<script>window.evil = true</script>\n<img src=x onerror=evil()>'],
  ])("renders readable inert receipt text while retaining exact raw result: %s", async (raw, preview) => {
    const receipt: McpToolCallReceipt = {
      call_id: CALL_ID, request_id: REQUEST_ID, connection_id: null,
      server_origin: "https://mcp.deepwiki.com", tool_name: "read_wiki_structure",
      outcome: "succeeded", is_error: false, error_code: null,
      result_summary: raw.slice(0, 100), result_json: raw,
      executed_at: "2026-10-04T00:00:00.000Z",
      source: { kind: "mcp_tool_result", connection_id: null, server_origin: "https://mcp.deepwiki.com", tool_name: "read_wiki_structure", protocol_version: "2025-11-25" },
    };
    fetcher.mockImplementation(async () => new Response(JSON.stringify({ request: request({ state: "submitted", receipt }) }), { status: 200 }));
    await act(async () => root.render(createElement(McpRequestCard, { requestId: REQUEST_ID, sessionVersion: SESSION_VERSION })));
    await flush();
    const allPre = [...mount.querySelectorAll("pre")];
    expect(allPre[1]!.textContent).toBe(preview);
    expect(allPre[2]!.textContent).toBe(raw);
    expect(mount.textContent).toContain(CALL_ID);
    expect(mount.textContent).toContain("https://mcp.deepwiki.com");
    expect(mount.querySelector("script, img")).toBeNull();
  });

});
