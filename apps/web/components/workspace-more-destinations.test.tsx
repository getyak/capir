// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_ORGANIZATION_PREFIX, resetSessionOrganizationStores } from "@/lib/workspace-session-organization";
import { WORKSPACE_NEW_CONVERSATION_EVENT, WORKSPACE_RAIL_COLLAPSED_KEY } from "@/lib/workspace-navigation";
import type { MarketingLocale } from "@/lib/marketing-locale";
import { LocaleProvider } from "./locale-provider";

const state = vi.hoisted(() => ({ pathname: "/workspace", search: "", mobile: false, binding: "current", failed: false, loading: false, push: vi.fn(), retry: vi.fn(), rows: [] as { session_id: string; state: string; expires_at: string; title: string; person_id?: string; person_label?: string; is_unread?: boolean }[] }));
vi.mock("next/navigation", () => ({ usePathname: () => state.pathname, useSearchParams: () => new URLSearchParams(state.search), useRouter: () => ({ push: state.push }) }));
vi.mock("./workspace-search", () => ({
  useWorkspaceDirectory: () => ({ data: { sessions: { session_version: state.binding, sessions: state.rows }, people: { people: [] } }, loading: state.loading, failed: state.failed, retry: state.retry }),
  WorkspaceGlobalSearchDialog: ({ label }: { label: string }) => createElement("button", { "aria-label": label }, "Search"),
}));
import { WorkspaceShellNav } from "./workspace-shell-nav";
import { WorkspaceRecentSessions } from "./workspace-recent-sessions";
import { WorkspaceNavigationContinuityProvider } from "./workspace-navigation-continuity";
import { WorkspaceSidebarPeople } from "./workspace-sidebar-people";

const SCOPE = "a".repeat(64), OTHER_SCOPE = "b".repeat(64);
const id = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
let host: HTMLDivElement, root: Root;
async function render(scope = SCOPE, locale?: MarketingLocale) {
  const content = createElement(WorkspaceNavigationContinuityProvider, { scope }, createElement("div", null,
    createElement(WorkspaceShellNav, { binding: "current", storageScope: scope }),
    createElement(WorkspaceRecentSessions, { binding: "current", storageScope: scope }),
    state.pathname.startsWith("/workspace/people") ? createElement(WorkspaceSidebarPeople, { binding: "current" }) : null,
  ));
  await act(async () => root.render(locale ? <LocaleProvider locale={locale}>{content}</LocaleProvider> : content));
}
function button(label: string) { return host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!; }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.resetAllMocks(); window.localStorage.clear(); resetSessionOrganizationStores();
  state.pathname = "/workspace"; state.search = ""; state.mobile = false; state.binding = "current"; state.failed = false; state.loading = false;
  state.rows = Array.from({ length: 10 }, (_, n) => ({ session_id: id(n + 1), state: "active", expires_at: "2099-01-01T00:00:00.000Z", title: `Conversation ${n + 1}` }));
  vi.spyOn(window, "matchMedia").mockImplementation(() => ({ matches: state.mobile, addEventListener: () => {}, removeEventListener: () => {} }) as unknown as MediaQueryList);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });

describe("expanded and collapsed workspace navigation", () => {
  it.each([
    ["en", "原始标题 (Unread)", "Unread"],
    ["ja", "原始标题（未読）", "未読"],
    ["ko", "原始标题 (읽지 않음)", "읽지 않음"],
  ] as const)("localizes unread state in %s without translating the user's title", async (locale, label, status) => {
    state.rows = [{ ...state.rows[0]!, title: "原始标题", is_unread: true }];
    await render(SCOPE, locale);
    const shortcut = host.querySelector(`[aria-label="最近对话快捷方式"] a[href="/workspace/sessions/${id(1)}"]`)!;
    expect(shortcut.getAttribute("aria-label")).toBe(label);
    expect(shortcut.getAttribute("title")).toBe(label);
    const expanded = host.querySelector(`section[aria-label="最近对话"] a[href="/workspace/sessions/${id(1)}"]`)!;
    expect(expanded.textContent).toContain("原始标题");
    expect(expanded.textContent).toContain(status);
  });

  it("keeps primary destinations in the same keyboard order and places compose after them", async () => {
    await render();
    const expected = ["今日", "对话", "人物", "时间", "搜索人物或对话"];
    for (const label of ["工作台导航", "工作台导航（已收起）"]) {
      const nav = host.querySelector(`nav[aria-label="${label}"]`)!;
      const controls = [...nav.querySelectorAll<HTMLElement>('a[aria-label],button[aria-label]')];
      expect(controls.map(item => item.getAttribute("aria-label")).filter(name => expected.includes(name!))).toEqual(expected);
      if (label.endsWith("（已收起）")) {
        const compose = controls.findIndex(item => item.getAttribute("aria-label") === "开始新对话");
        const search = controls.findIndex(item => item.getAttribute("aria-label") === "搜索人物或对话");
        expect(compose).toBeGreaterThan(search);
      }
    }
  });

  it("wires remembered exact locations into both presentations of the actual navigation", async () => {
    state.pathname = `/workspace/sessions/${id(1)}`; await render();
    state.pathname = "/workspace/meetings"; state.search = "day=2026-10-13&view=week&tz=UTC&upcoming=30"; await render();
    state.pathname = "/workspace/people"; state.search = "query=old"; await render();
    const input = host.querySelector<HTMLInputElement>('input[aria-label="搜索侧栏人物"]')!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => { setValue.call(input, "visible search"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await render();
    state.pathname = "/workspace/today"; state.search = ""; await render();
    for (const selector of ['nav[aria-label="工作台导航"]', '[data-collapsed-only="true"]']) {
      const nav = host.querySelector(selector)!;
      expect(nav.querySelector('a[aria-label="对话"]')?.getAttribute("href")).toBe(`/workspace/sessions/${id(1)}`);
      expect(nav.querySelector('a[aria-label="时间"]')?.getAttribute("href")).toBe("/workspace/meetings?day=2026-10-13&view=week&tz=UTC&upcoming=30");
      expect(nav.querySelector('a[aria-label="人物"]')?.getAttribute("href")).toBe("/workspace/people?query=visible%20search");
    }
  });

  it("shows conversation titles by default and uses the same pinned/archive projection in the collapsed rail", async () => {
    window.localStorage.setItem(SESSION_ORGANIZATION_PREFIX + SCOPE, JSON.stringify({ v: 1, scope: SCOPE, entries: {
      [id(1)]: { archived: true, pinned: false, updatedAt: new Date().toISOString() },
      [id(10)]: { archived: false, pinned: true, updatedAt: new Date().toISOString() },
    } }));
    await render();
    const recent = host.querySelector('section[aria-label="最近对话"]')!;
    expect(recent.querySelector('button[aria-expanded="true"]')?.textContent).toContain("最近对话");
    const collapsed = host.querySelector('[data-collapsed-only="true"]')!;
    const shortcuts = [...collapsed.querySelectorAll<HTMLAnchorElement>('a[title^="Conversation"]')];
    expect(shortcuts.map(link => link.getAttribute("href"))).toEqual([10, 2, 3, 4, 5].map(n => `/workspace/sessions/${id(n)}`));
    expect(shortcuts.some(link => link.title === "Conversation 1")).toBe(false);
    expect(recent.querySelector('a[title="Conversation 10"]')).toBeTruthy();
    await render(OTHER_SCOPE);
    expect([...collapsed.querySelectorAll<HTMLAnchorElement>('a[title^="Conversation"]')][0]!.title).toBe("Conversation 1");
  });

  it("uses a neutral conversation symbol without inventing a person and preserves real avatars and unread meaning", async () => {
    const person = "22222222-2222-4222-8222-222222222222";
    state.rows = [
      { ...state.rows[0]!, title: "Unbound conversation", is_unread: true },
      { ...state.rows[1]!, title: "Pilot scope", person_id: person, person_label: "林岚" },
      { ...state.rows[2]!, title: "Next meeting", person_id: person, person_label: "林岚" },
    ];
    await render();
    for (const selector of ['section[aria-label="最近对话"]', '[aria-label="最近对话快捷方式"]']) {
      const list = host.querySelector(selector)!;
      const unbound = list.querySelector(`a[href="/workspace/sessions/${id(1)}"]`)!;
      expect(unbound.querySelector('[data-avatar-style]')).toBeNull();
      expect(unbound.querySelector('[aria-hidden="true"] svg')).toBeTruthy();
      for (const n of [2, 3]) {
        expect(list.querySelector(`a[href="/workspace/sessions/${id(n)}"] [data-avatar-style]`)).toBeTruthy();
      }
    }
    const recent = host.querySelector('section[aria-label="最近对话"]')!;
    expect(recent.querySelector(`a[href="/workspace/sessions/${id(1)}"]`)?.textContent).toContain("未读");
    const collapsed = host.querySelector('[aria-label="最近对话快捷方式"]')!;
    expect(collapsed.querySelector(`a[href="/workspace/sessions/${id(1)}"]`)?.getAttribute("aria-label")).toBe("Unbound conversation（未读）");
    expect(collapsed.querySelector(`a[href="/workspace/sessions/${id(2)}"]`)?.getAttribute("aria-label")).toBe("Pilot scope");
    expect(collapsed.querySelector(`a[href="/workspace/sessions/${id(3)}"]`)?.getAttribute("aria-label")).toBe("Next meeting");
    await act(async () => button("归档：Pilot scope").click());
    const archived = [...host.querySelectorAll("button")].find(item => item.textContent?.startsWith("已归档"))!;
    await act(async () => archived.click());
    expect(recent.querySelector(`a[data-archived="true"][href="/workspace/sessions/${id(2)}"] [data-avatar-style]`)).toBeTruthy();
  });

  it.each([
    ["/workspace/people/11111111-1111-4111-8111-111111111111", "人物"],
    ["/workspace/pursuits/example", "今日"],
    ["/workspace/meetings/example", "时间"],
    ["/workspace/sessions/11111111-1111-4111-8111-111111111111", "对话"],
  ])("marks the collapsed primary destination on child route %s", async (pathname, label) => {
    state.pathname = pathname; await render();
    const nav = host.querySelector('nav[aria-label="工作台导航（已收起）"]')!;
    expect(nav).toBeTruthy();
    expect(nav.querySelector(`a[aria-label="${label}"]`)?.getAttribute("aria-current")).toBe("page");
  });

  it("hands focus to the visible toggle after both collapse and expand", async () => {
    await render(); button("收起侧边栏").focus();
    await act(async () => button("收起侧边栏").click());
    expect(window.localStorage.getItem(WORKSPACE_RAIL_COLLAPSED_KEY)).toBe("true");
    expect(document.activeElement).toBe(button("展开侧边栏"));
    await act(async () => button("展开侧边栏").click());
    expect(document.activeElement).toBe(button("收起侧边栏"));
  });

  it("updates the collapsed projection immediately after expanded archive, restore, and pin actions", async () => {
    await render();
    const shortcuts = () => [...host.querySelectorAll<HTMLAnchorElement>('[data-collapsed-only="true"] a[title^="Conversation"]')].map(link => link.title);
    await act(async () => button("归档：Conversation 1").click());
    expect(shortcuts()).not.toContain("Conversation 1");
    const archiveDisclosure = [...host.querySelectorAll("button")].find(item => item.textContent?.startsWith("已归档"))!;
    await act(async () => archiveDisclosure.click());
    await act(async () => button("恢复：Conversation 1").click());
    expect(shortcuts()[0]).toBe("Conversation 1");
    await act(async () => button("置顶：Conversation 8").click());
    expect(shortcuts()[0]).toBe("Conversation 8");
  });

  it("keeps whole-directory access when every recent conversation is locally archived", async () => {
    state.rows = state.rows.slice(0, 2);
    window.localStorage.setItem(SESSION_ORGANIZATION_PREFIX + SCOPE, JSON.stringify({ v: 1, scope: SCOPE, entries: Object.fromEntries(state.rows.map(row => [row.session_id, { archived: true, pinned: false, updatedAt: new Date().toISOString() }])) }));
    await render();
    const recent = host.querySelector('section[aria-label="最近对话"]')!;
    expect([...recent.querySelectorAll("a")].find(link => link.textContent === "查看全部对话")?.getAttribute("href")).toBe("/workspace/sessions");
  });

  it("keeps toggles and shared organization usable when browser storage is unavailable", async () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new Error("denied"); });
    await render(); button("收起侧边栏").focus();
    await act(async () => button("收起侧边栏").click());
    expect(host.querySelector('[data-collapsed="true"]')).toBeTruthy();
    expect(document.activeElement).toBe(button("展开侧边栏"));
    await act(async () => button("展开侧边栏").click());
    await act(async () => button("归档：Conversation 1").click());
    expect(host.querySelector('[data-collapsed-only="true"] a[title="Conversation 1"]')).toBeNull();
    expect(host.textContent).toContain("归档与置顶仅在本页保留");
  });

  it("provides an explicit collapsed fresh conversation action with a fresh draft locator", async () => {
    await render();
    const action = host.querySelector<HTMLButtonElement>('[data-collapsed-only="true"] button[aria-label="开始新对话"]');
    expect(action).toBeTruthy(); await act(async () => action!.click());
    const first = String(state.push.mock.calls[0]?.[0]);
    expect(first).toMatch(/^\/workspace\?draft_session=[0-9a-f-]{36}&intent=compose$/u);
    await act(async () => action!.click());
    expect(state.push.mock.calls[1]?.[0]).not.toBe(first);
  });

  it("lets the mounted conversation handle New conversation without duplicate navigation", async () => {
    await render(); const handled = (event: Event) => event.preventDefault();
    window.addEventListener(WORKSPACE_NEW_CONVERSATION_EVENT, handled);
    try { await act(async () => button("开始新对话").click()); expect(state.push).not.toHaveBeenCalled(); }
    finally { window.removeEventListener(WORKSPACE_NEW_CONVERSATION_EVENT, handled); }
  });

  it("keeps mobile New conversation click modifiers as ordinary links", async () => {
    state.mobile = true; await render();
    const action = host.querySelector<HTMLAnchorElement>('nav[aria-label="工作台导航"] a[aria-label="新对话"]')!;
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true });
    await act(async () => action.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(false); expect(state.push).not.toHaveBeenCalled();
    await act(async () => action.click());
    expect(String(state.push.mock.calls[0]?.[0])).toMatch(/^\/workspace\?draft_session=[0-9a-f-]{36}&intent=compose$/u);
  });

  it("hides failed or incorrectly bound recent projections and keeps retry and whole-directory access", async () => {
    state.failed = true; await render();
    expect(host.querySelector('[data-collapsed-only="true"] a[title^="Conversation"]')).toBeNull();
    expect(host.textContent).toContain("暂时无法读取");
    await act(async () => [...host.querySelectorAll("button")].find(item => item.textContent === "重试")!.click());
    expect(state.retry).toHaveBeenCalledOnce();
    state.failed = false; state.binding = "other"; await render();
    expect(host.querySelector('[data-collapsed-only="true"] a[title^="Conversation"]')).toBeNull();
    expect(host.querySelector('a[href="/workspace/sessions"]')).toBeTruthy();
  });
});
