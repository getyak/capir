// @vitest-environment happy-dom
import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CONTRACT_VERSION } from "@talent-signal/contracts";
import { requestWorkspaceRefresh } from "@/lib/workspace-refresh";
import { WORKSPACE_SESSION_EXPIRED_EVENT } from "./workspace-session-request";
import { TodayContext, useTodayContext } from "./today-context";

const instant = new Date("2026-10-18T02:00:00Z");
const id = "00000000-0000-4000-8000-000000000001";
const arrangement = { id: `schedule:${id}`, kind: "schedule", source_id: id, source_revision: 2,
  title: "只读安排", summary: "自己记录", occurred_at: "2026-10-18T03:00:00Z", recorded_at: "2026-10-17T00:00:00Z",
  ends_at: "2026-10-18T04:00:00Z", local_day: "2026-10-18", time_zone: "Asia/Shanghai", all_day: false,
  person_id: null, person_label: null, relationship_context_id: null, context_label: null, session_id: null,
  status: "planned", authority: "user_authored", external_effect: "none" };
let root: Root, mount: HTMLDivElement;
let current: ReturnType<typeof useTodayContext>;
const request = vi.fn();
function Probe({ binding }: { binding: string }) {
  const value = useTodayContext(binding, "2030-01-01T00:00:00Z");
  useLayoutEffect(() => { current = value; });
  return null;
}
async function flush() { await act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); }); }
async function render(binding = "current") { await act(async () => root.render(createElement(Probe, { binding }))); await flush(); }
function response(url: string, extra: Record<string, unknown> = {}) {
  if (url.startsWith("/api/time/activities")) {
    const params = new URL(url, "http://localhost").searchParams;
    return Response.json({ contract_version: CONTRACT_VERSION, scope: { from: params.get("from"), to: params.get("to"), time_zone: params.get("time_zone"), kind: "schedule" },
      activities: [arrangement], complete: true, next_cursor: null, snapshot_at: instant.toISOString(), coverage_note: "当前范围", session_version: "current", ...extra });
  }
  return Response.json({ sessions: [], complete: true, next_cursor: null, session_version: "current", ...extra });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(instant);
  vi.stubGlobal("fetch", request);
  request.mockReset().mockImplementation(async (url: string) => response(url));
  mount = document.createElement("div"); mount.dataset.workspaceScope = "test-scope";
  document.body.append(mount); root = createRoot(mount);
});
afterEach(async () => { await act(async () => root.unmount()); mount.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("reads only canonical Time and unread metadata with current binding and preserves their independent results", async () => {
  request.mockImplementation(async (url: string) => url.startsWith("/api/workspace-sessions") ? Response.json({}, { status: 503 }) : response(url));
  await render();
  expect(current.schedule).toMatchObject({ item: { source_id: id }, coverage: "complete" });
  expect(current.unread).toMatchObject({ item: null, coverage: "unavailable" });
  expect(request.mock.calls).toHaveLength(2);
  for (const [url, options] of request.mock.calls) {
    expect(url).toMatch(/^\/api\/(time\/activities|workspace-sessions)/);
    expect(options.method ?? "GET").toBe("GET");
    expect(options.headers.get("x-workspace-session")).toBe("current");
    expect(options.cache).toBe("no-store");
  }
});

it("bounds activity pagination to three pages and labels unexhausted coverage partial", async () => {
  let pages = 0;
  request.mockImplementation(async (url: string) => response(url, url.startsWith("/api/time") ? { complete: false, next_cursor: `cursor-${++pages}` } : {}));
  await render();
  expect(pages).toBe(3);
  expect(current.schedule.coverage).toBe("partial");
});

it("fails closed on repeated cursors rather than retrying an unbounded read", async () => {
  request.mockImplementation(async (url: string) => response(url, url.startsWith("/api/time") ? { complete: false, next_cursor: "repeat" } : {}));
  await render();
  expect(request.mock.calls.filter(([url]) => url.startsWith("/api/time"))).toHaveLength(2);
  expect(current.schedule).toMatchObject({ item: null, coverage: "unavailable" });
});

it("keeps a useful first page explicitly partial when the next page is unavailable", async () => {
  let pages = 0;
  request.mockImplementation(async (url: string) => {
    if (!url.startsWith("/api/time")) return response(url);
    return ++pages === 1 ? response(url, { complete: false, next_cursor: "second" }) : Response.json({}, { status: 503 });
  });
  await render();
  expect(current.schedule).toMatchObject({ item: { source_id: id }, coverage: "partial" });
  expect(current.unread.coverage).toBe("complete");
});

it("discards late old-account responses, including their titles, after binding changes", async () => {
  const pending: Array<() => void> = [];
  request.mockImplementation((url: string) => new Promise(resolve => pending.push(() => resolve(response(url)))));
  await render();
  await render("other");
  await act(async () => { pending.forEach(resolve => resolve()); }); await flush();
  expect(current.schedule.item).toBeNull();
  expect(current.unread.item).toBeNull();
});

it("clears current claims immediately when credentials expire and does not repopulate from late callbacks", async () => {
  await render(); expect(current.schedule.item?.source_id).toBe(id);
  await act(async () => window.dispatchEvent(new Event(WORKSPACE_SESSION_EXPIRED_EVENT)));
  expect(current.schedule.item).toBeNull();
  await act(async () => requestWorkspaceRefresh("current")); await flush();
  expect(current.schedule.item).toBeNull();
});

it("reuses the shared refresh owner, coalesces in-flight requests and releases it on unmount", async () => {
  await render();
  let release: (() => void) | undefined;
  request.mockImplementation((url: string) => url.startsWith("/api/time") ? new Promise(resolve => { release = () => resolve(response(url, { activities: [] })); }) : Promise.resolve(response(url)));
  await act(async () => { requestWorkspaceRefresh("current"); requestWorkspaceRefresh("current"); }); await flush();
  expect(request.mock.calls).toHaveLength(4);
  await act(async () => release?.()); await flush();
  expect(current.schedule.item).toBeNull();
  await act(async () => root.unmount());
  const count = request.mock.calls.length;
  requestWorkspaceRefresh("current");
  expect(request.mock.calls).toHaveLength(count);
  root = createRoot(mount);
});

it("does not start network reads in a hidden surface and resumes through the existing foreground coordinator", async () => {
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  await render(); expect(request).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTimeAsync(20_000)); await flush();
  expect(request).not.toHaveBeenCalled();
  hidden.mockReturnValue(false);
  await act(async () => requestWorkspaceRefresh("current", "foreground")); await flush();
  expect(request.mock.calls).toHaveLength(2);
  expect(current.schedule.item?.source_id).toBe(id);
});

it("advances the local date on foreground refresh and removes elapsed arrangement claims", async () => {
  await render(); const previous = current.day;
  vi.setSystemTime(new Date("2026-10-19T02:00:00Z"));
  await act(async () => requestWorkspaceRefresh("current", "foreground")); await flush();
  expect(current.day).not.toBe(previous);
  expect(current.schedule.item).toBeNull();
});

it("removes an expired unread title at its deadline even while a shared refresh is still in flight", async () => {
  const unread = { session_id: id, revision: 1, title: "即将过期的解释", state: "active", updated_at: instant.toISOString(),
    expires_at: "2026-10-18T02:00:15Z", turn_count: 1, is_unread: true };
  request.mockImplementation(async (url: string) => response(url, url.startsWith("/api/workspace-sessions") ? { sessions: [unread] } : {}));
  await render();
  expect(current.unread.item?.title).toBe(unread.title);
  request.mockImplementation(() => new Promise(() => undefined));
  await act(async () => vi.advanceTimersByTimeAsync(11_000)); await flush();
  await act(async () => vi.advanceTimersByTimeAsync(4_001)); await flush();
  expect(current.unread.item).toBeNull();
});

it("clears all source claims at the explicit credential deadline without waiting for a server response", async () => {
  await act(async () => root.render(createElement(TodayContext, { binding: "current", expiresAt: "2026-10-18T02:00:05Z" })));
  await flush(); expect(mount.textContent).toContain("只读安排");
  await act(async () => vi.advanceTimersByTimeAsync(5_001)); await flush();
  expect(mount.textContent).not.toContain("只读安排");
  expect(mount.textContent).toContain("暂时无法读取");
});

it("bounds a stalled source to fifteen seconds and keeps independently verified metadata available", async () => {
  request.mockImplementation((url: string) => url.startsWith("/api/time") ? new Promise(() => undefined) : Promise.resolve(response(url)));
  await render(); expect(current.schedule.coverage).toBe("loading");
  await act(async () => vi.advanceTimersByTimeAsync(15_001)); await flush();
  expect(current.schedule.coverage).toBe("unavailable");
  expect(current.unread.coverage).toBe("complete");
  request.mockImplementation(async (url: string) => response(url));
  await act(async () => current.retry()); await flush();
  expect(current.schedule.item?.source_id).toBe(id);
});

it("cannot repaint a timed-out title when an abort-insensitive transport eventually returns", async () => {
  let deliver: (() => void) | undefined;
  request.mockImplementation((url: string) => url.startsWith("/api/time") ? new Promise(resolve => {
    deliver = () => resolve(response(url));
  }) : Promise.resolve(response(url)));
  await render();
  await act(async () => vi.advanceTimersByTimeAsync(15_001)); await flush();
  expect(current.schedule.coverage).toBe("unavailable");
  await act(async () => deliver?.()); await flush();
  expect(current.schedule).toMatchObject({ item: null, coverage: "unavailable" });
});

it("renders source-specific loading and failure copy instead of saying the whole day is empty", async () => {
  request.mockImplementation(async () => Response.json({}, { status: 503 }));
  await act(async () => root.render(createElement(TodayContext, { binding: "current", expiresAt: "2030-01-01T00:00:00Z" })));
  await flush();
  expect(mount.textContent).toContain("安排暂时无法读取");
  expect(mount.textContent).toContain("未读对话暂时无法读取");
  expect(mount.textContent).not.toContain("没有安排");
  expect(mount.querySelector("button")?.textContent).toContain("重试");
});

it("links the real arrangement ID and carries its date, original zone and user authorship", async () => {
  await act(async () => root.render(createElement(TodayContext, { binding: "current", expiresAt: "2030-01-01T00:00:00Z" })));
  await flush();
  expect(mount.querySelector("h1 time")?.getAttribute("datetime")).toBe("2026-10-18");
  expect(mount.querySelector("h1")?.textContent).toContain("10月18日");
  expect(mount.querySelector("h1")?.textContent).toContain("星期日");
  const link = [...mount.querySelectorAll("a")].find(a => a.textContent?.includes("只读安排"));
  expect(link).toBeTruthy();
  const url = new URL(link!.href);
  expect(url.searchParams.get("item")).toBe(`schedule:${id}`);
  expect(url.searchParams.get("tz")).toBe("Asia/Shanghai");
  expect(url.searchParams.get("day")).toBe("2026-10-18");
  expect(mount.textContent).toContain("由你记录");
  expect(mount.textContent).toContain("Asia/Shanghai");
});
