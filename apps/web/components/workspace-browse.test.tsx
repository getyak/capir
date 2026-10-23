// @vitest-environment happy-dom
import { act, useEffect, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const route = vi.hoisted(() => ({
  pathname: "/workspace", search: "", mobile: false, navigations: [] as string[], push: vi.fn(), mounts: 0,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => route.pathname,
  useSearchParams: () => new URLSearchParams(route.search),
  useRouter: () => ({ push: route.push }),
}));
vi.mock("next/link", () => ({
  default: ({ prefetch, scroll, onClick, ...props }: ComponentProps<"a"> & { prefetch?: boolean; scroll?: boolean }) => {
    void prefetch; void scroll;
    return <a {...props} onClick={event => {
      onClick?.(event);
      if (!event.defaultPrevented) route.navigations.push(String(props.href));
      event.preventDefault();
    }} />;
  },
}));
vi.mock("./workspace-search", () => ({
  WorkspaceGlobalSearchDialog: () => null,
  useWorkspaceDirectory: () => ({ data: null }),
}));
vi.mock("@/lib/workspace-session-organization", () => ({
  organizeSessionRows: () => [], useSessionOrganization: () => ({}),
}));
vi.mock("./workspace-recent-sessions", () => ({ WorkspaceRecentSessions: () => <section>最近对话</section> }));
vi.mock("./workspace-sidebar-people", () => ({ WorkspaceSidebarPeople: () => <section>人物目录<input aria-label="目录测试草稿" /></section> }));
vi.mock("./workspace-sidebar-calendar", () => ({ WorkspaceSidebarCalendar: () => <section>日历导航</section> }));

import { WorkspaceBrowseProvider, useWorkspaceBrowse } from "./workspace-browse";
import { WorkspaceShellNav } from "./workspace-shell-nav";
import { WorkspaceSidebarContext } from "./workspace-sidebar-context";
import { WORKSPACE_SESSION_EXPIRED_EVENT } from "./workspace-session-request";
import { invalidateWorkspaceDirectory } from "@/lib/workspace-directory-cache";

let host: HTMLDivElement, root: Root;
const SCOPE = "a".repeat(64);
function Editor() {
  useEffect(() => { route.mounts++; }, []);
  return <textarea aria-label="工作草稿" defaultValue="继续写这段话" />;
}
function Probe() {
  const browse = useWorkspaceBrowse();
  return <>
    <output>{browse?.href("/workspace/people")}</output>
    <button onClick={() => browse?.remember("/workspace/people?query=committed")}>保存目录位置</button>
    <button onClick={() => browse?.remember("/workspace/people?token=secret")}>拒绝未准入位置</button>
  </>;
}
async function render(scope: string | null = SCOPE) {
  await act(async () => root.render(
    <WorkspaceBrowseProvider scope={scope} key={scope} binding="a">
      <WorkspaceShellNav binding="a" storageScope={scope} />
      <WorkspaceSidebarContext binding="a" storageScope={scope} />
      <Editor /><Probe />
    </WorkspaceBrowseProvider>,
  ));
}
function primary(label: string) {
  return host.querySelector<HTMLAnchorElement>(`nav[aria-label="工作台导航"] a[aria-label="${label}"]`)!;
}
async function click(element: Element, init: MouseEventInit = {}) {
  await act(async () => element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...init })));
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  route.pathname = "/workspace"; route.search = ""; route.mobile = false; route.navigations = []; route.mounts = 0; route.push.mockReset();
  Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: route.mobile, addEventListener() {}, removeEventListener() {} }) });
  window.localStorage.clear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });

describe("independent desktop browser", () => {
  it("changes only the left section and retains the working draft node, selection and scroll", async () => {
    await render();
    const draft = host.querySelector<HTMLTextAreaElement>('textarea')!;
    draft.value = "写到这里，先查人物"; draft.setSelectionRange(2, 5); draft.scrollTop = 72;
    for (const label of ["人物", "时间", "今日", "对话"]) await click(primary(label));
    expect(route.navigations).toEqual([]); expect(route.push).not.toHaveBeenCalled();
    expect(route.pathname).toBe("/workspace"); expect(route.mounts).toBe(1);
    expect(host.querySelector("textarea")).toBe(draft);
    expect(draft.value).toBe("写到这里，先查人物");
    expect([draft.selectionStart, draft.selectionEnd, draft.scrollTop]).toEqual([2, 5, 72]);
    expect(primary("对话").getAttribute("aria-current")).toBe("location");
  });

  it("retains visited sidebar panels and independent scroll without reading every section up front", async () => {
    await render(); expect(host.querySelector('input')).toBeNull();
    await click(primary("人物"));
    const input = host.querySelector<HTMLInputElement>('input')!, panel = input.parentElement!.parentElement!;
    input.value = "目录草稿"; panel.scrollTop = 91;
    await click(primary("时间")); expect(panel.hidden).toBe(true);
    await click(primary("人物")); expect(panel.hidden).toBe(false);
    expect(host.querySelector("input")).toBe(input); expect(input.value).toBe("目录草稿"); expect(panel.scrollTop).toBe(91);
  });

  it("does not let a later work route replace left selection or its vetted locator", async () => {
    route.pathname = "/workspace/people"; route.search = "query=initial"; await render();
    await click([...host.querySelectorAll("button")].find(button => button.textContent === "保存目录位置")!);
    route.pathname = "/workspace/meetings"; route.search = "day=2026-10-23"; await render();
    expect(primary("人物").getAttribute("aria-current")).toBe("location");
    expect(host.querySelector("output")?.textContent).toBe("/workspace/people?query=committed");
    await click([...host.querySelectorAll("button")].find(button => button.textContent === "拒绝未准入位置")!);
    expect(host.querySelector("output")?.textContent).toBe("/workspace/people?query=committed");
  });

  it("retains native modified clicks and mobile navigation", async () => {
    await render(); await click(primary("人物"), { metaKey: true });
    expect(route.navigations).toEqual(["/workspace/people"]);
    route.mobile = true; await render(); await click(primary("时间"));
    expect(route.navigations).toEqual(["/workspace/people", "/workspace/meetings"]);
    await click(primary("新对话")); expect(route.push).toHaveBeenCalledWith(expect.stringMatching(/^\/workspace\?draft_session=/));
  });

  it("expands the collapsed browser without navigating the work route", async () => {
    await render();
    await click(host.querySelector('[aria-label="收起侧边栏"]')!);
    expect(host.querySelector('[data-collapsed]')?.getAttribute("data-collapsed")).toBe("true");
    const compactPeople = host.querySelector<HTMLAnchorElement>('nav[aria-label="工作台导航（已收起）"] a[aria-label="人物"]')!;
    compactPeople.focus();
    await click(compactPeople);
    expect(route.navigations).toEqual([]);
    expect(host.querySelector('[data-collapsed]')?.getAttribute("data-collapsed")).toBe("false");
    expect(primary("人物").getAttribute("aria-current")).toBe("location");
    expect(document.activeElement).toBe(primary("人物"));
  });

  it("withdraws retained panels and locators on expiry and resets at a new authenticated scope", async () => {
    await render(); await click(primary("人物"));
    await click([...host.querySelectorAll("button")].find(button => button.textContent === "保存目录位置")!);
    await act(async () => window.dispatchEvent(new Event(WORKSPACE_SESSION_EXPIRED_EVENT)));
    expect(host.querySelector("#workspace-sidebar-browser input")).toBeNull();
    expect(host.querySelector("output")?.textContent).toBe("/workspace/people");
    await click([...host.querySelectorAll("button")].find(button => button.textContent === "保存目录位置")!);
    expect(host.querySelector("output")?.textContent).toBe("/workspace/people");
    route.pathname = "/workspace/people";
    await render();
    expect(primary("人物").getAttribute("aria-current")).toBe("page");
    expect(primary("对话").getAttribute("aria-current")).toBeNull();
    expect(host.querySelector("#workspace-sidebar-browser input")).toBeNull();
    route.pathname = "/workspace";
    await render("b".repeat(64));
    expect(host.querySelector("output")?.textContent).toBe("/workspace/people");
    expect(primary("对话").getAttribute("aria-current")).toBe("location");
  });

  it("withdraws a matching revoked binding without confusing revalidation or another account with revocation", async () => {
    await render(); await click(primary("人物"));
    await act(async () => invalidateWorkspaceDirectory("b", "discard"));
    await act(async () => invalidateWorkspaceDirectory("a", "revalidate"));
    expect(host.querySelector("#workspace-sidebar-browser input")).not.toBeNull();
    await act(async () => invalidateWorkspaceDirectory("a", "discard"));
    expect(host.querySelector("#workspace-sidebar-browser input")).toBeNull();
  });
});
