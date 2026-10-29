// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearAllListOrder, LIST_ORDER_PREFIX } from "@/lib/workspace-list-order";
import { resetSessionOrganizationStores, sessionOrganizationStore } from "@/lib/workspace-session-organization";
import { LocaleProvider } from "./locale-provider";
import { WorkspaceListOrderScope } from "./workspace-list-order";
import { WorkspaceRecentSessions } from "./workspace-recent-sessions";
import { WorkspaceSidebarPeople } from "./workspace-sidebar-people";

const data = vi.hoisted(() => ({ pathname: "/workspace", query: "", payload: {} as unknown }));
vi.mock("next/navigation", () => ({ usePathname: () => data.pathname, useSearchParams: () => new URLSearchParams(data.query), useRouter: () => ({ push: vi.fn() }) }));
vi.mock("./workspace-navigation-continuity", () => ({ useRememberWorkspaceNavigationHref: () => vi.fn() }));
vi.mock("./workspace-search", () => ({ useWorkspaceDirectory: () => ({ data: data.payload, loading: false, failed: false, retry: vi.fn() }) }));

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const SCOPE = "a".repeat(64);
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  // Geometry and pointer state are under test here. A live frame loop makes
  // happy-dom's async act wait forever; real auto-scroll is browser acceptance.
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  localStorage.clear(); clearAllListOrder(); resetSessionOrganizationStores();
  data.pathname = "/workspace"; data.query = "";
  data.payload = {
    sessions: { session_version: "binding", sessions: [A, B, C].map((id, index) => ({ session_id: id, title: `合成议题 ${index} 🧭`, state: "active", expires_at: "2030-01-01T00:00:00Z" })) },
    people: { people: [A, B, C].map((id, index) => ({ id, display_label: `合成人物 ${index}`, contexts: [] })) },
  };
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: async (_key: string, _options: unknown, action: () => boolean) => action() } });
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { configurable: true, value: () => {} });
  Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", { configurable: true, value: () => false });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); clearAllListOrder(); });
async function render(people = false, scope = SCOPE) {
  await act(async () => root.render(<LocaleProvider locale="zh-CN"><WorkspaceListOrderScope scope={scope}>
    {people ? <WorkspaceSidebarPeople binding="binding" /> : <WorkspaceRecentSessions binding="binding" storageScope={scope} />}
  </WorkspaceListOrderScope></LocaleProvider>));
}
const ids = () => [...host.querySelectorAll<HTMLElement>("[data-order-id]")].map(row => row.dataset.orderId);
const row = (id: string) => host.querySelector<HTMLElement>(`[data-order-id="${id}"]`)!;
const handle = (id: string) => row(id).querySelector<HTMLButtonElement>("button[title]")!;
function geometry() {
  [A, B, C].forEach((id, index) => vi.spyOn(row(id), "getBoundingClientRect").mockReturnValue({ x: 0, y: index * 50, left: 0, right: 240, top: index * 50, bottom: index * 50 + 48, width: 240, height: 48, toJSON: () => ({}) }));
  vi.spyOn(document, "elementFromPoint").mockImplementation((x, y) => {
    if (x < 0 || x > 240) return null;
    return [A, B, C].map(row).find(element => { const rect = element.getBoundingClientRect(); return y >= rect.top && y <= rect.bottom; }) ?? null;
  });
}
async function pointer(id: string, type: string, y: number, x = 220) {
  await act(async () => handle(id).dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, pointerType: "mouse", button: 0, clientX: x, clientY: y })));
}
async function menuMove(id: string, text: string) {
  await act(async () => handle(id).click());
  const action = [...document.querySelectorAll<HTMLButtonElement>('[data-slot="popover-content"] button')].find(button => button.textContent === text)!;
  await act(async () => action.click());
}

it("keeps a pinned state marker, pin groups and the exact selected Session while rearranging real rows", async () => {
  sessionOrganizationStore(SCOPE).setFlag(A, "pinned", true);
  data.pathname = `/workspace/sessions/${B}`;
  await render(); geometry();
  expect(row(A).querySelectorAll("small")).toHaveLength(0);
  expect(row(A).querySelector('a[aria-label]')?.getAttribute("aria-label")).toContain("置顶");
  const selected = row(B).querySelector('a[aria-current="page"]');
  await pointer(C, "pointerdown", 120); await pointer(C, "pointermove", 5); await pointer(C, "pointerup", 5);
  expect(ids()).toEqual([A, B, C]);
  await pointer(C, "pointerdown", 120); await pointer(C, "pointermove", 52); await pointer(C, "pointerup", 52);
  expect(ids()).toEqual([A, C, B]);
  expect(row(B).querySelector('a[aria-current="page"]')).toBe(selected);
  const click = new MouseEvent("click", { bubbles: true, cancelable: true });
  await act(async () => handle(C).dispatchEvent(click));
  expect(click.defaultPrevented).toBe(true);
});

it("offers equivalent People menu moves, preserves focus/DOM, and isolates the other list and workspace", async () => {
  await render(true);
  const anchor = row(B).querySelector("a");
  handle(B).focus();
  await menuMove(B, "上移");
  expect(ids()).toEqual([B, A, C]);
  expect(row(B).querySelector("a")).toBe(anchor);
  expect(localStorage.getItem(LIST_ORDER_PREFIX + SCOPE + ":people")).toContain(B);
  expect(localStorage.getItem(LIST_ORDER_PREFIX + SCOPE + ":sessions")).toBeNull();
  await render(true, "b".repeat(64));
  expect(ids()).toEqual([A, B, C]);
  await render(true);
  expect(ids()).toEqual([B, A, C]);
});

it("offers explicit People arrangement without changing order or replacing row links", async () => {
  await render(true);
  const anchor = row(B).querySelector("a");
  const organize = host.querySelector<HTMLButtonElement>('button[aria-label="整理人物"]')!;
  expect(organize.getAttribute("aria-pressed")).toBe("false");
  expect(row(B).dataset.orderControls).toBe("quiet");
  expect(row(B).dataset.orderOrganizing).toBeUndefined();
  expect(handle(B).getAttribute("aria-hidden")).toBeNull();
  await act(async () => organize.click());
  expect(organize.getAttribute("aria-pressed")).toBe("true");
  expect(organize.textContent).toBe("完成");
  expect(organize.getAttribute("aria-label")).toBe("完成 · 整理人物");
  expect(row(B).dataset.orderOrganizing).toBe("true");
  await menuMove(B, "上移");
  expect(ids()).toEqual([B, A, C]);
  expect(row(B).querySelector("a")).toBe(anchor);
  await act(async () => organize.click());
  expect(organize.getAttribute("aria-pressed")).toBe("false");
  expect(row(B).dataset.orderOrganizing).toBeUndefined();
  expect(ids()).toEqual([B, A, C]);
});

it("cancels Escape, pointer cancellation and invalid drops without writing", async () => {
  await render(); geometry();
  await pointer(C, "pointerdown", 120); await pointer(C, "pointermove", 2);
  expect(host.querySelector('[data-order-edge="before"]')).not.toBeNull();
  await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  await pointer(C, "pointerup", 2);
  expect(ids()).toEqual([A, B, C]);
  expect(host.querySelector("[data-order-edge]")).toBeNull();
  await pointer(C, "pointerdown", 120); await pointer(C, "pointermove", 52); await pointer(C, "pointercancel", 52);
  await pointer(C, "pointerdown", 120); await pointer(C, "pointermove", 5, 400); await pointer(C, "pointerup", 5, 400);
  expect(localStorage.getItem(LIST_ORDER_PREFIX + SCOPE + ":sessions")).toBeNull();
});

it("disables rearrangement during People search instead of moving hidden records", async () => {
  data.pathname = "/workspace/people"; data.query = "query=" + encodeURIComponent("合成人物 1");
  await render(true);
  expect(ids()).toEqual([B]);
  expect(handle(B).getAttribute("title")).toContain("清除搜索");
  await act(async () => handle(B).click());
  const actions = [...document.querySelectorAll<HTMLButtonElement>('[data-slot="popover-content"] button')];
  expect(actions).toHaveLength(3); expect(actions.every(action => action.disabled)).toBe(true);
  expect(localStorage.getItem(LIST_ORDER_PREFIX + SCOPE + ":people")).toBeNull();
});

it("rejects a row whose rectangle is under clipped or covering chrome", async () => {
  await render(); geometry();
  vi.mocked(document.elementFromPoint).mockReturnValue(document.body);
  await pointer(C, "pointerdown", 120); await pointer(C, "pointermove", 5); await pointer(C, "pointerup", 5);
  expect(ids()).toEqual([A, B, C]);
  expect(localStorage.getItem(LIST_ORDER_PREFIX + SCOPE + ":sessions")).toBeNull();
});

it("waits for a pending relative move instead of queuing the old neighbor twice", async () => {
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const request = vi.fn(async (_key: string, _options: unknown, action: () => boolean) => { await gate; return action(); });
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request } });
  await render(true);
  await menuMove(C, "上移");
  await act(async () => handle(C).click());
  const up = [...document.querySelectorAll<HTMLButtonElement>('[data-slot="popover-content"] button')].find(button => button.textContent === "上移")!;
  expect(up.disabled).toBe(true);
  await act(async () => up.click());
  expect(request).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  expect(ids()).toEqual([A, C, B]);
});

it("hydrates the real People list without replacing links when local controls appear", async () => {
  const element = <LocaleProvider locale="zh-CN"><WorkspaceListOrderScope scope={SCOPE}><WorkspaceSidebarPeople binding="binding" /></WorkspaceListOrderScope></LocaleProvider>;
  await act(async () => root.unmount());
  host.innerHTML = renderToString(element);
  expect(host.querySelector("button[title]")).toBeNull();
  const anchor = host.querySelector('a[href*="/workspace/people/' + A + '"]');
  const recover = vi.fn();
  await act(async () => { root = hydrateRoot(host, element, { onRecoverableError: recover }); });
  expect(recover).not.toHaveBeenCalled();
  expect(host.querySelector('a[href*="/workspace/people/' + A + '"]')).toBe(anchor);
  expect(handle(A)).not.toBeNull();
});
