// @vitest-environment happy-dom
import { act, createElement, type ComponentProps, type SubmitEvent } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pathname: "/workspace/people",
  search: "",
  binding: "account-a",
  fetch: vi.fn(),
  remember: vi.fn(),
  submitted: [] as string[],
}));
vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useSearchParams: () => new URLSearchParams(mocks.search),
}));
vi.mock("next/link", () => ({
  default: ({ prefetch, scroll, ...props }: ComponentProps<"a"> & { prefetch?: boolean; scroll?: boolean }) => {
    void scroll;
    return createElement("a", { ...props, "data-prefetch": String(prefetch) });
  },
}));
vi.mock("next/form", () => ({
  default: ({ action, scroll, onSubmit, ...props }: ComponentProps<"form"> & { scroll?: boolean }) => {
    void scroll;
    return createElement("form", {
      ...props,
      action,
      onSubmit: (event: SubmitEvent<HTMLFormElement>) => {
        onSubmit?.(event);
        if (!event.defaultPrevented) {
          const url = new URL(String(action), "https://capri.test");
          event.currentTarget.querySelectorAll<HTMLInputElement>("input[name]").forEach(input =>
            url.searchParams.set(input.name, input.value));
          mocks.submitted.push(`${url.pathname}${url.search}`);
        }
        event.preventDefault();
      },
    });
  },
}));
vi.mock("./person-directory-avatar", () => ({ PersonDirectoryAvatar: () => null }));
vi.mock("./workspace-navigation-continuity", () => ({
  useRememberWorkspaceNavigationHref: () => mocks.remember,
}));
vi.mock("./workspace-session-request", () => ({
  workspaceSessionFetch: mocks.fetch,
  WORKSPACE_SESSION_EXPIRED_EVENT: "test-session-expired",
}));

import { invalidateWorkspaceDirectory } from "@/lib/workspace-directory-cache";
import { requestWorkspaceRefresh } from "@/lib/workspace-refresh";
import { WorkspaceDirectoryScope } from "./workspace-directory-cache";
import { WorkspaceSidebarPeople } from "./workspace-sidebar-people";

const firstId = "11111111-1111-4111-8111-111111111111";
const secondId = "22222222-2222-4222-8222-222222222222";
const session = "33333333-3333-4333-8333-333333333333";
const rows = [
  { id: firstId, display_label: "同名人物", contexts: [{ id: "context-a", display_label: "产品沟通" }] },
  { id: secondId, display_label: "同名人物", contexts: [{ id: "context-b", display_label: "合作伙伴" }] },
];
let host: HTMLDivElement;
let root: Root;

function allowRead(people = rows, binding = mocks.binding) {
  mocks.fetch.mockImplementation(async (url: string) => Response.json(
    url.includes("/people") ? { people } : { session_version: binding, sessions: [] },
  ));
}
async function render(binding: string | null = mocks.binding) {
  await act(async () => root.render(
    <WorkspaceDirectoryScope binding={binding}><WorkspaceSidebarPeople binding={binding} /></WorkspaceDirectoryScope>,
  ));
}
function searchInput() {
  return host.querySelector<HTMLInputElement>('input[aria-label="搜索侧栏人物"]')!;
}
async function type(value: string) {
  const input = searchInput();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function submit() {
  await act(async () => searchInput().form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
}
function links() {
  return Array.from(host.querySelectorAll<HTMLAnchorElement>('nav[aria-label="侧栏人物"] a'));
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mocks.pathname = "/workspace/people";
  mocks.search = "";
  mocks.binding = "account-a";
  mocks.submitted.length = 0;
  mocks.fetch.mockReset();
  mocks.remember.mockReset();
  invalidateWorkspaceDirectory(undefined, "discard");
  allowRead();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  invalidateWorkspaceDirectory(undefined, "discard");
});

describe("contextual People directory", () => {
  it("opens exact living pages for same-name people and preserves the directory/session return", async () => {
    mocks.pathname = `/workspace/people/${secondId}`;
    mocks.search = `directory_query=${encodeURIComponent("同名")}&session=${session}`;
    await render();
    const people = links();
    expect(people).toHaveLength(2);
    expect(people.map(link => link.getAttribute("href"))).toEqual([
      `/workspace/people/${firstId}?directory_query=${encodeURIComponent("同名")}&session=${session}`,
      `/workspace/people/${secondId}?directory_query=${encodeURIComponent("同名")}&session=${session}`,
    ]);
    expect(people[0].getAttribute("aria-current")).toBeNull();
    expect(people[1].getAttribute("aria-current")).toBe("page");
    expect(people.every(link => link.dataset.prefetch === "false")).toBe(true);
    expect(mocks.fetch.mock.calls.map(([url]) => url)).toEqual([
      "/api/local-integration/people", "/api/workspace-sessions",
    ]);
    expect(host.textContent).not.toContain("相关人物");
    expect(host.querySelector('button[aria-label*="人物背景"]')).toBeNull();
  });

  it("filters the full bounded projection, including secondary contexts, without claiming exhaustive search", async () => {
    const people = Array.from({ length: 201 }, (_, index) => ({
      id: `person-${index}`, display_label: `合成人物 ${index}`,
      contexts: [{ id: `context-${index}`, display_label: "普通关系" }],
    }));
    people[199].contexts.push({ id: "match", display_label: "ＡＢＣ 合作" });
    people[200].display_label = "隐藏目录人物";
    allowRead(people);
    await render();
    expect(links()).toHaveLength(200);
    expect(host.textContent).toContain("侧栏仅显示目录前 200 位人物");
    await type("  abc  ");
    expect(links()).toHaveLength(1);
    expect(links()[0].getAttribute("href")).toBe("/workspace/people/person-199?directory_query=abc");
    expect(mocks.remember).toHaveBeenLastCalledWith("/workspace/people?query=abc");
    await type("隐藏目录人物");
    expect(links()).toHaveLength(0);
    expect(host.textContent).toContain("侧栏目录中没有匹配人物");
    expect(host.textContent).not.toContain("没有找到此人物");
    expect(Array.from(host.querySelectorAll("a")).find(link => link.textContent === "查看全部人物")?.getAttribute("href"))
      .toBe(`/workspace/people?query=${encodeURIComponent("隐藏目录人物")}`);
  });

  it("commits search into the actual directory URL and restores it on a later People mount", async () => {
    mocks.search = `session=${session}`;
    await render();
    await type("合作伙伴");
    await submit();
    expect(mocks.submitted).toEqual([`/workspace/people?query=${encodeURIComponent("合作伙伴")}&session=${session}`]);
    await act(async () => root.render(<WorkspaceDirectoryScope binding={mocks.binding} />));
    mocks.search = `query=${encodeURIComponent("合作伙伴")}&session=${session}`;
    await render();
    expect(searchInput().value).toBe("合作伙伴");
    expect(links()).toHaveLength(1);
  });

  it("remembers the visible filter and carries it through Person selection without pressing Enter", async () => {
    mocks.search = `session=${session}`;
    await render();
    await type("合作伙伴");
    const remembered = `/workspace/people?query=${encodeURIComponent("合作伙伴")}&session=${session}`;
    expect(mocks.submitted).toEqual([]);
    expect(mocks.remember).toHaveBeenLastCalledWith(remembered);
    const selected = links()[0];
    const detail = new URL(selected.getAttribute("href")!, "https://capri.test");
    expect(detail.pathname).toBe(`/workspace/people/${secondId}`);
    expect(detail.searchParams.get("directory_query")).toBe("合作伙伴");
    expect(detail.searchParams.get("session")).toBe(session);
    await act(async () => selected.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
    expect(mocks.remember).toHaveBeenLastCalledWith(remembered);
    mocks.pathname = detail.pathname;
    mocks.search = detail.search;
    await render();
    expect(searchInput().value).toBe("合作伙伴");
    expect(links()[0].getAttribute("aria-current")).toBe("page");

    await act(async () => root.render(<WorkspaceDirectoryScope binding={mocks.binding} />));
    // The provider owns returning to the recorded route; verify this component
    // restores the href it supplied, without inventing a second query store.
    const returning = new URL(mocks.remember.mock.calls.at(-1)![0], "https://capri.test");
    mocks.pathname = returning.pathname;
    mocks.search = returning.search;
    await render();
    expect(searchInput().value).toBe("合作伙伴");
    expect(links()).toHaveLength(1);
  });

  it("preserves an IME draft and the input node through refresh, and rejects provisional submission", async () => {
    await render();
    const input = searchInput();
    input.focus();
    await act(async () => input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })));
    await type("同名");
    await submit();
    expect(mocks.submitted).toEqual([]);
    expect(mocks.remember).not.toHaveBeenCalled();
    expect(links().every(link => !link.getAttribute("href")!.includes("directory_query"))).toBe(true);
    await act(async () => requestWorkspaceRefresh(mocks.binding, "focus"));
    expect(searchInput()).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("同名");
    await act(async () => input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })));
    expect(mocks.remember).toHaveBeenLastCalledWith(`/workspace/people?query=${encodeURIComponent("同名")}`);
    expect(links().every(link => new URL(link.getAttribute("href")!, "https://capri.test").searchParams.get("directory_query") === "同名")).toBe(true);
    await submit();
    expect(mocks.submitted).toEqual([`/workspace/people?query=${encodeURIComponent("同名")}`]);
  });

  it("clears both search and its return URL while retaining the originating Session", async () => {
    mocks.search = `query=${encodeURIComponent("同名")}&session=${session}`;
    await render();
    const clear = host.querySelector<HTMLAnchorElement>('[aria-label="清除侧栏人物搜索"]')!;
    expect(clear.getAttribute("href")).toBe(`/workspace/people?session=${session}`);
    await act(async () => clear.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
    expect(searchInput().value).toBe("");
    expect(document.activeElement).toBe(searchInput());
    expect(mocks.remember).toHaveBeenLastCalledWith(`/workspace/people?session=${session}`);
  });

  it("does not submit the Enter used to select an IME candidate even if composition already ended", async () => {
    await render();
    await type("同名");
    const input = searchInput();
    const candidate = new KeyboardEvent("keydown", { key: "Enter", keyCode: 229, bubbles: true, cancelable: true });
    await act(async () => input.dispatchEvent(candidate));
    expect(candidate.defaultPrevented).toBe(false);
    await submit();
    expect(mocks.submitted).toEqual([]);
    await act(async () => input.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true })));
    await submit();
    expect(mocks.submitted).toEqual([`/workspace/people?query=${encodeURIComponent("同名")}`]);
  });

  it("removes previous-account rows and local drafts on binding change or logout", async () => {
    await render();
    await type("同名");
    mocks.binding = "account-b";
    allowRead([{ id: "b", display_label: "新账号人物", contexts: [] }]);
    await render();
    expect(searchInput().value).toBe("");
    expect(host.textContent).not.toContain("同名人物");
    expect(host.textContent).toContain("新账号人物");
    await render(null);
    expect(host.querySelector("input")).toBeNull();
    expect(host.textContent).not.toContain("新账号人物");
    expect(host.textContent).toContain("请重新登录");
  });

  it("keeps loading and failed reads distinct from an empty directory and retries without stale rows", async () => {
    const pending: Array<(response: Response) => void> = [];
    mocks.fetch.mockImplementation(() => new Promise(resolve => pending.push(resolve)));
    await render();
    expect(host.textContent).toContain("正在读取人物目录");
    expect(host.textContent).not.toContain("还没有人物");
    await act(async () => pending.forEach(resolve => resolve(Response.json({}, { status: 503 }))));
    expect(host.textContent).toContain("人物目录暂时无法读取");
    expect(host.textContent).not.toContain("还没有人物");
    allowRead();
    await act(async () => Array.from(host.querySelectorAll("button")).find(button => button.textContent === "重新载入")!.click());
    expect(links()).toHaveLength(2);
    mocks.fetch.mockResolvedValue(Response.json({}, { status: 503 }));
    await act(async () => requestWorkspaceRefresh(mocks.binding, "focus"));
    expect(host.textContent).toContain("人物目录暂时无法读取");
    expect(host.textContent).not.toContain("同名人物");
  });

  it("retains a truthful empty-directory entry and refuses ambiguous search values", async () => {
    mocks.search = "query=one&query=two&session=untrusted";
    allowRead([]);
    await render();
    expect(searchInput().value).toBe("");
    expect(host.textContent).toContain("还没有人物");
    expect(host.textContent).toContain("查看全部人物");
    expect(host.querySelector('input[name="session"]')).toBeNull();
  });
});
