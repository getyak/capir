// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { McpDirectoryPanel } from "./mcp-directory";

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_VERSION = "workspace-session-binding-v1";
const CONNECTION_ID = "33333333-3333-4333-8333-333333333333";

const fetcher = vi.hoisted(() => vi.fn());
let stagedKind = "form";

let mount: HTMLDivElement;
let root: Root;

async function flush() {
  await act(async () => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  });
}

function button(label: string): HTMLButtonElement {
  const found = [...mount.querySelectorAll("button")].find((item) => item.textContent === label);
  if (!found) throw new Error(`button not found: ${label}`);
  return found;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mount = document.createElement("div");
  document.body.appendChild(mount);
  const scope = document.createElement("div");
  scope.setAttribute("data-workspace-scope", "account-scope-token");
  document.body.appendChild(scope);
  root = createRoot(mount);
  vi.stubGlobal("fetch", fetcher);
  fetcher.mockReset();
  stagedKind = "form";
  fetcher.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/directory")) {
      return new Response(
        JSON.stringify({
          entries: [
            {
              auth_mode: "anonymous",
              id: "context7",
              name: "Context7",
              oauth_available: false,
              server_url: "https://mcp.context7.com/mcp",
              summary: "Up-to-date library documentation.",
              verified_domain: "mcp.context7.com",
            },
            {
              auth_mode: "oauth",
              id: "notion",
              name: "Notion",
              oauth_available: false,
              server_url: "https://mcp.notion.com/mcp",
              summary: "Read your Notion workspace.",
              verified_domain: "mcp.notion.com",
            },
          ],
        }),
        { status: 200 },
      );
    }
    if (url.endsWith("/oauth/availability")) {
      return new Response(JSON.stringify({ available: false }), { status: 200 });
    }
    if (url.includes("/interactions/propose-connection")) {
      return new Response(
        JSON.stringify({
          request: {
            id: REQUEST_ID,
            kind: "form",
            purpose: "添加 Context7 的远程 MCP 服务。",
            state: "pending",
          },
        }),
        { status: 201 },
      );
    }
    if (url.includes("/interactions/propose-call")) {
      stagedKind = "approval";
      return new Response(
        JSON.stringify({
          request: {
            id: REQUEST_ID,
            kind: "approval",
            purpose: "调用 lookup。",
            state: "pending",
          },
        }),
        { status: 201 },
      );
    }
    if (url.includes(`/interactions/${REQUEST_ID}`)) {
      return new Response(
        JSON.stringify({
          request: {
            arguments_display: "{}",
            argument_schema: null,
            call_id: REQUEST_ID,
            choices: [],
            created_at: "2026-10-04T00:00:00.000Z",
            expires_at: "2030-01-01T00:00:00.000Z",
            id: REQUEST_ID,
            kind: stagedKind as "form" | "approval",
            message_id: null,
            oauth: null,
            purpose: "添加 Context7 的远程 MCP 服务。",
            receipt: null,
            resolved_at: null,
            revision: 1,
            schema_unsupported_reason: null,
            session_id: null,
            state: "pending",
            target: {
              auth_mode: "anonymous",
              connection_id: null,
              connection_label: "Context7",
              server_origin: "https://mcp.context7.com",
              tool_name: null,
            },
            updated_at: "2026-10-04T00:00:00.000Z",
          },
        }),
        { status: 200 },
      );
    }
    if (url.endsWith("/interactions")) {
      return new Response(JSON.stringify({ requests: [] }), { status: 200 });
    }
    if (url.endsWith("/connections")) {
      return new Response(
        JSON.stringify({
          connections: [
            {
              auth_mode: "anonymous",
              created_at: "2026-10-04T00:00:00.000Z",
              credential_configured: false,
              friendly_name: "Context7",
              id: CONNECTION_ID,
              last_checked_at: null,
              last_error_code: null,
              last_error_message: null,
              oauth_connected: false,
              revision: 1,
              server_url: "https://mcp.context7.com/mcp",
              status: "verified",
              tools: [
                {
                  description: "Lookup library docs",
                  input_schema: '{"type":"object","properties":{"query":{"type":"string"}}}',
                  name: "lookup",
                  read_only: true,
                },
                {
                  description: "List libraries",
                  input_schema: '{"type":"object","properties":{"topic":{"type":"string"}}}',
                  name: "list_libraries",
                  read_only: true,
                },
              ],
              tools_count: 2,
              updated_at: "2026-10-04T00:00:00.000Z",
            },
          ],
        }),
        { status: 200 },
      );
    }
    return new Response("{}", { status: 200 });
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  mount.remove();
  document.body.querySelector("[data-workspace-scope]")?.remove();
  vi.unstubAllGlobals();
});

function sessionHeaderOf(call: unknown[]): string | null {
  const init = call[1] as RequestInit | undefined;
  return new Headers(init?.headers ?? {}).get("x-workspace-session");
}

describe("McpDirectoryPanel", () => {
  it("shows real curated services with exact verified domains and honest OAuth state", async () => {
    await act(async () => root.render(createElement(McpDirectoryPanel, { sessionVersion: SESSION_VERSION })));
    await flush();
    expect(mount.textContent).toContain("mcp.context7.com");
    expect(mount.textContent).toContain("mcp.notion.com");
    expect(mount.textContent).toContain("OAuth 暂未配置，无法授权");
    const oauthButtons = [...mount.querySelectorAll("button")].filter(
      (item) => item.textContent === "添加连接",
    );
    expect(oauthButtons).toHaveLength(2);
    expect(oauthButtons[1]!.disabled).toBe(true);
  });

  it("stages a real connection request instead of faking success", async () => {
    await act(async () => root.render(createElement(McpDirectoryPanel, { sessionVersion: SESSION_VERSION })));
    await flush();
    await act(async () => button("添加连接").click());
    await flush();
    const stageCall = fetcher.mock.calls.find((call) =>
      String(call[0]).includes("/interactions/propose-connection"),
    )!;
    for (const call of fetcher.mock.calls) expect(sessionHeaderOf(call)).toBe(SESSION_VERSION);
    const body = JSON.parse(String(stageCall[1]!.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      auth_mode: "anonymous",
      directory_entry_id: "context7",
      server_url: "https://mcp.context7.com/mcp",
    });
    // The staged request card is rendered from the canonical request.
    expect(mount.textContent).toContain("连接表单");
  });

  it("uses discovered input schemas and per-tool identity on the approved call path", async () => {
    await act(async () => root.render(createElement(McpDirectoryPanel, { sessionVersion: SESSION_VERSION })));
    await flush();
    expect(mount.textContent).toContain("lookup");
    expect(mount.textContent).toContain("只读标注（不构成授权）");
    // The second tool's button stages the second tool, not the first.
    await act(async () => button("提交精确调用请求（list_libraries）").click());
    await flush();
    const call = fetcher.mock.calls.find((item) =>
      String(item[0]).includes("/interactions/propose-call"),
    )!;
    for (const item of fetcher.mock.calls) expect(sessionHeaderOf(item)).toBe(SESSION_VERSION);
    const body = JSON.parse(String(call[1]!.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      arguments: "{}",
      connection_id: CONNECTION_ID,
      tool_name: "list_libraries",
    });
    expect(mount.textContent).toContain("工具调用确认");

    // A fresh deliberate call gets a fresh bounded idempotency key.
    await act(async () => button("提交精确调用请求（lookup）").click());
    await flush();
    const calls = fetcher.mock.calls.filter((item) =>
      String(item[0]).includes("/interactions/propose-call"),
    );
    expect(calls).toHaveLength(2);
    const keys = calls.map((item) =>
      String(JSON.parse(String((item[1] as RequestInit).body)).idempotency_key),
    );
    expect(new Set(keys).size).toBe(2);
    for (const key of keys) expect(key.length).toBeLessThanOrEqual(128);
    expect(calls.map((item) => String(JSON.parse(String((item[1] as RequestInit).body)).tool_name)))
      .toEqual(["list_libraries", "lookup"]);
  });
  it.each(["/directory", "/oauth/availability", "/connections", "/interactions"])("blocks all writes on a partial canonical read failure: %s", async (failedPath) => {
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => String(input).endsWith(failedPath) ? new Response("{}", { status: 409 }) : original(input, init));
    await act(async () => root.render(createElement(McpDirectoryPanel, { sessionVersion: SESSION_VERSION })));
    await flush();
    expect(mount.textContent).toContain("无法读取完整");
    expect(button("提交连接请求").closest("fieldset")?.disabled).toBe(true);
    expect(fetcher.mock.calls.some((call) => String(call[0]).includes("propose-"))).toBe(false);
    await act(async () => button("重新加载").click());
    await flush();
    expect(fetcher.mock.calls.filter((call) => String(call[0]).endsWith(failedPath))).toHaveLength(2);
  });

  it("reuses a failed intent only for identical exact arguments and scope", async () => {
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => String(input).includes("propose-call") ? new Response("{}", { status: 503 }) : original(input, init));
    await act(async () => root.render(createElement(McpDirectoryPanel, { sessionVersion: SESSION_VERSION })));
    await flush();
    const field = [...mount.querySelectorAll("input")].find((item) => item.closest("form")?.textContent?.includes("（lookup）"))!;
    const fill = async (value: string) => act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const submitted = (count: number) => vi.waitFor(async () => {
      await flush();
      expect(fetcher.mock.calls.filter((call) => String(call[0]).includes("propose-call"))).toHaveLength(count);
      expect(button("提交精确调用请求（lookup）").disabled).toBe(false);
    }, { timeout: 2_000, interval: 10 });
    await fill("React hooks");
    await act(async () => button("提交精确调用请求（lookup）").click());
    await submitted(1);
    await act(async () => button("提交精确调用请求（lookup）").click());
    await submitted(2);
    await fill("React context");
    await act(async () => button("提交精确调用请求（lookup）").click());
    await submitted(3);
    await act(async () => root.render(createElement(McpDirectoryPanel, { sessionVersion: "other-user-session" })));
    await flush();
    await act(async () => button("提交精确调用请求（lookup）").click());
    await submitted(4);
    const calls = fetcher.mock.calls.filter((call) => String(call[0]).includes("propose-call"));
    const bodies = calls.map((call) => JSON.parse(String((call[1] as RequestInit).body)));
    expect(bodies[0].arguments).toBe('{"query":"React hooks"}');
    expect(bodies[0].idempotency_key).toBe(bodies[1].idempotency_key);
    expect(bodies[2].idempotency_key).not.toBe(bodies[1].idempotency_key);
    expect(bodies[3].idempotency_key).not.toBe(bodies[2].idempotency_key);
    expect(sessionHeaderOf(calls[3]!)).toBe("other-user-session");
  });

});
