// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONTRACT_VERSION, type TimeActivity, type TimeActivityListResponse } from "@talent-signal/contracts";
import { timeFixtureActivity } from "@/lib/test/time-fixtures";
import { timeHref } from "@/lib/time-workspace";
import { requestWorkspaceRefresh } from "@/lib/workspace-refresh";
import { invalidateWorkspaceDirectory } from "@/lib/workspace-directory-cache";
const mock = vi.hoisted(() => ({ query: "day=2026-09-21&view=week&tz=UTC", request: vi.fn() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(mock.query) }));
vi.mock("@/lib/time-workspace-client", async (original) => ({ ...await original<typeof import("@/lib/time-workspace-client")>(), timeRequest: mock.request }));
import { TimeRequestError } from "@/lib/time-workspace-client";
import { WORKSPACE_SESSION_EXPIRED_EVENT, workspaceSessionFetch } from "./workspace-session-request";
import { WorkspaceSidebarCalendar } from "./workspace-sidebar-calendar";

let host: HTMLDivElement, root: Root;
const nativeReplace = window.history.replaceState.bind(window.history);
const nativePush = window.history.pushState.bind(window.history);
function payload(url: string, activities: TimeActivity[] = [timeFixtureActivity], complete = true): TimeActivityListResponse {
  const query = new URL(url, "http://localhost").searchParams;
  return {
    contract_version: CONTRACT_VERSION,
    scope: { from: query.get("from")!, to: query.get("to")!, time_zone: query.get("time_zone")!, kind: "schedule", ...(query.get("person_id") ? { person_id: query.get("person_id")! } : {}) },
    activities, complete, next_cursor: complete ? null : "next", snapshot_at: "2026-09-21T00:00:00.000Z", coverage_note: "Only authorized current internal schedules.",
  };
}
async function render(binding: string | null = "a") {
  nativeReplace(null, "", `/workspace/meetings?${mock.query}`);
  await act(async () => root.render(createElement(WorkspaceSidebarCalendar, { binding })));
}
async function click(label: string) {
  const button = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`) ?? [...host.querySelectorAll("button")].find((item) => item.textContent === label);
  expect(button).toBeTruthy();
  await act(async () => button!.click());
}
function dateLink(day: string) { return host.querySelector<HTMLAnchorElement>(`[data-calendar-day="${day}"]`)!; }
async function key(day: string, value: string) {
  await act(async () => { dateLink(day).focus(); dateLink(day).dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true })); });
}
async function changeHorizon(value: string) {
  await act(async () => { const select = host.querySelector("select")!; select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); });
}
beforeEach(() => {
  vi.restoreAllMocks(); vi.resetAllMocks(); mock.query = "day=2026-09-21&view=week&tz=UTC";
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  mock.request.mockImplementation(async (url: string) => payload(url));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); Reflect.deleteProperty(document, "visibilityState"); Reflect.deleteProperty(document, "hidden"); });

describe("workspace calendar sidebar", () => {
  it("renders one selected date with an accessible fixed month grid and exact date URLs", async () => {
    mock.query += `&person=${timeFixtureActivity.source_id}&kind=session_activity&range=custom&from=2026-09-01&to=2026-09-30&item=old&draft=old&upcoming=30`;
    await render();
    expect(host.querySelector('table[role="grid"]')?.getAttribute("aria-label")).toBe("2026年9月小月历");
    expect(host.querySelectorAll('[role="gridcell"]')).toHaveLength(42);
    expect(host.querySelectorAll('[data-calendar-day][tabindex="0"]')).toHaveLength(1);
    expect(dateLink("2026-09-21").getAttribute("aria-current")).toBe("date");
    expect(dateLink("2026-09-21").getAttribute("aria-label")).toContain("已选中");
    const href = new URL(dateLink("2026-09-23").href);
    expect(href.pathname).toBe("/workspace/meetings");
    expect(Object.fromEntries(href.searchParams)).toMatchObject({ day: "2026-09-23", tz: "UTC", view: "week", range: "week", person: timeFixtureActivity.source_id, kind: "session_activity", upcoming: "30" });
    for (const name of ["from", "to", "item", "draft"]) expect(href.searchParams.has(name)).toBe(false);
  });

  it("previews previous and next months without changing the selected date or rereading schedules", async () => {
    await render(); const current = window.location.href, readCount = mock.request.mock.calls.length;
    await click("小月历下个月");
    expect(host.querySelector('table[role="grid"]')?.getAttribute("aria-label")).toBe("2026年10月小月历");
    expect(window.location.href).toBe(current); expect(mock.request).toHaveBeenCalledTimes(readCount);
    await click("返回选中日期"); expect(dateLink("2026-09-21").getAttribute("aria-current")).toBe("date");
    await click("小月历上个月"); expect(host.querySelector('table[role="grid"]')?.getAttribute("aria-label")).toBe("2026年8月小月历");
  });

  it("moves keyboard focus by date across month boundaries and clamps Page Down to February", async () => {
    mock.query = "day=2026-01-31&tz=UTC"; await render();
    await key("2026-01-31", "PageDown");
    expect(document.activeElement).toBe(dateLink("2026-02-28"));
    await key("2026-02-28", "ArrowRight"); expect(document.activeElement).toBe(dateLink("2026-03-01"));
    await key("2026-03-01", "Home"); expect(document.activeElement).toBe(dateLink("2026-02-23"));
    await key("2026-02-23", "End"); expect(document.activeElement).toBe(dateLink("2026-03-01"));
    expect(new URL(window.location.href).searchParams.get("day")).toBe("2026-01-31");
  });

  it("bounds month navigation at the supported ISO date boundary", async () => {
    mock.query = "day=9999-12-31&tz=UTC"; await render();
    expect(host.querySelector<HTMLButtonElement>('button[aria-label="小月历下个月"]')?.disabled).toBe(true);
    expect(host.textContent).toContain("此日期超出可读取范围"); expect(mock.request).not.toHaveBeenCalled();
    expect(dateLink("9999-12-31").getAttribute("aria-current")).toBe("date");
  });

  it("reads only the selected seven-day schedule scope and names an active person filter", async () => {
    mock.query += `&person=${timeFixtureActivity.source_id}&kind=session_activity`; await render();
    const [url, binding, options] = mock.request.mock.calls[0]!;
    expect(binding).toBe("a"); expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(Object.fromEntries(new URL(url, "http://localhost").searchParams)).toEqual({ from: "2026-09-21", to: "2026-09-28", time_zone: "UTC", kind: "schedule", person_id: timeFixtureActivity.source_id });
    expect(host.querySelector('section[aria-label="近期内部安排"]')?.textContent).toContain("起 · 内部安排 · 已按人物筛选");
    expect(mock.request.mock.calls.every(([, , init]) => !init.method || init.method === "GET")).toBe(true);
  });

  it("keeps the horizon in the calendar URL, including a rapid date change before rerender", async () => {
    await render(); nativePush(null, "", "/workspace/meetings?day=2026-09-25&tz=Asia%2FShanghai&view=month");
    await changeHorizon("30");
    const current = new URL(window.location.href).searchParams;
    expect(Object.fromEntries(current)).toMatchObject({ day: "2026-09-25", tz: "Asia/Shanghai", view: "month", upcoming: "30" });
    mock.query = current.toString(); await render();
    expect(host.querySelector("select")?.value).toBe("30");
    expect(new URL(mock.request.mock.lastCall![0], "http://localhost").searchParams.get("to")).toBe("2026-10-25");
    expect(dateLink("2026-09-25").getAttribute("aria-current")).toBe("date");
  });

  it("shows actual time, all-day intent, and exact schedule identity without reading private notes", async () => {
    const allDay = { ...timeFixtureActivity, id: "schedule:b1000000-0000-4000-8000-000000000002", source_id: "b1000000-0000-4000-8000-000000000002", title: "All day intent", all_day: true, summary: "Private note must stay hidden", person_label: "Synthetic person" };
    mock.request.mockImplementation(async (url: string) => payload(url, [allDay, timeFixtureActivity])); await render();
    const links = [...host.querySelectorAll<HTMLAnchorElement>("ol a")];
    expect(links).toHaveLength(2); expect(host.textContent).toContain("全天"); expect(host.textContent).toContain("Synthetic person");
    expect(host.textContent).not.toContain("Private note must stay hidden");
    const query = new URL(links[1]!.href).searchParams;
    expect(query.get("item")).toBe(allDay.id); expect(query.get("day")).toBe("2026-09-21");
    expect(query.get("kind")).toBe("schedule"); expect(query.get("view")).toBe("week");
  });

  it("does not imply completion from passed end times and omits cancelled or completed arrangements", async () => {
    const ended = { ...timeFixtureActivity, title: "Still user planned" };
    mock.request.mockImplementation(async (url: string) => payload(url, [ended, { ...timeFixtureActivity, id: "cancelled", title: "Cancelled intent", status: "cancelled" }, { ...timeFixtureActivity, id: "completed", title: "Completed intent", status: "completed" }]));
    await render(); expect(host.textContent).toContain("Still user planned");
    expect(host.textContent).not.toContain("Cancelled intent"); expect(host.textContent).not.toContain("Completed intent");
  });

  it("bounds visible records while keeping a link to the exact read horizon", async () => {
    mock.query += "&upcoming=30";
    mock.request.mockImplementation(async (url: string) => payload(url, Array.from({ length: 6 }, (_, i) => {
      const id = `b1000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`;
      return { ...timeFixtureActivity, id: `schedule:${id}`, source_id: id, title: `Schedule ${i}` };
    }))); await render();
    expect(host.querySelectorAll("ol li")).toHaveLength(4);
    const link = [...host.querySelectorAll<HTMLAnchorElement>("a")].find((item) => item.textContent?.includes("已读取 6 条"))!;
    const query = new URL(link.href).searchParams;
    expect(Object.fromEntries(query)).toMatchObject({ day: "2026-09-21", view: "timeline", range: "custom", from: "2026-09-21", to: "2026-10-21", kind: "schedule", upcoming: "30" });
  });

  it("keeps loading, failed, successful empty, and incomplete empty results distinct", async () => {
    let resolve!: (value: unknown) => void; mock.request.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    await render(); expect(host.textContent).toContain("正在读取安排"); expect(host.textContent).not.toContain("没有待进行");
    await act(async () => resolve({ invalid: true })); expect(host.textContent).toContain("安排暂时无法读取");
    mock.request.mockImplementation(async (url: string) => payload(url, [])); await click("重试");
    expect(host.textContent).toContain("这段时间没有待进行的内部安排"); expect(host.textContent).not.toContain("暂时无法读取");
    mock.query += "&upcoming=30"; mock.request.mockImplementation(async (url: string) => payload(url, [], false)); await render();
    expect(host.textContent).toContain("已读取记录中没有待进行的内部安排"); expect(host.textContent).toContain("范围尚未读完");
    expect(host.textContent).not.toContain("这段时间没有待进行");
  });

  it("rejects structurally valid data returned for a different scope", async () => {
    mock.request.mockImplementation(async (url: string) => ({ ...payload(url), scope: { ...payload(url).scope, from: "2026-09-20" } }));
    await render(); expect(host.textContent).toContain("安排暂时无法读取"); expect(host.textContent).not.toContain("Synthetic meeting");
  });

  it("aborts and hides a stale scope while rejecting its late response", async () => {
    let resolve!: (value: unknown) => void; let oldUrl = "";
    mock.request.mockImplementationOnce((url: string) => { oldUrl = url; return new Promise((done) => { resolve = done; }); });
    await render(); const signal = mock.request.mock.calls[0]![2].signal as AbortSignal;
    mock.query = "day=2026-09-22&tz=UTC"; mock.request.mockImplementation(async (url: string) => payload(url, [{ ...timeFixtureActivity, title: "New scope", local_day: "2026-09-22" }])); await render();
    expect(signal.aborted).toBe(true);
    await act(async () => resolve(payload(oldUrl, [{ ...timeFixtureActivity, title: "Stale private title" }])));
    expect(host.textContent).toContain("New scope"); expect(host.textContent).not.toContain("Stale private title");
  });

  it("clears records on session expiry, aborts the read, and restores only under a new binding", async () => {
    await render(); expect(host.textContent).toContain("Synthetic meeting");
    let resolve!: (value: unknown) => void, pendingUrl = "";
    mock.request.mockImplementationOnce((url: string) => { pendingUrl = url; return new Promise((done) => { resolve = done; }); });
    await act(async () => requestWorkspaceRefresh("a"));
    const signal = mock.request.mock.lastCall![2].signal as AbortSignal;
    await act(async () => window.dispatchEvent(new Event(WORKSPACE_SESSION_EXPIRED_EVENT)));
    expect(signal.aborted).toBe(true); expect(host.textContent).not.toContain("Synthetic meeting"); expect(host.textContent).toContain("登录已失效");
    await act(async () => resolve(payload(pendingUrl, [{ ...timeFixtureActivity, title: "Expired private schedule" }])));
    expect(host.textContent).not.toContain("Expired private schedule");
    mock.query += "&upcoming=30"; await render(); expect(host.textContent).toContain("登录已失效");
    await render("b"); expect(mock.request.mock.lastCall![1]).toBe("b"); expect(host.textContent).toContain("Synthetic meeting");
  });

  it("fails closed for a stale binding and never requests without a binding", async () => {
    await render(null); expect(mock.request).not.toHaveBeenCalled(); expect(host.textContent).toContain("登录后查看安排");
    mock.request.mockRejectedValue(new TimeRequestError("Stale", 409, "session_stale")); await render();
    expect(host.textContent).toContain("登录已失效"); expect(host.textContent).not.toContain("没有待进行");
  });

  it("withdraws loaded schedules on a matching directory discard and cannot reread that binding", async () => {
    await render(); expect(host.textContent).toContain("Synthetic meeting");
    const reads = mock.request.mock.calls.length;
    await act(async () => {
      invalidateWorkspaceDirectory("a", "discard");
      requestWorkspaceRefresh("a");
    });
    expect(host.textContent).not.toContain("Synthetic meeting"); expect(host.textContent).toContain("登录已失效");
    expect(mock.request).toHaveBeenCalledTimes(reads);
    mock.query += "&upcoming=30"; await render();
    await act(async () => invalidateWorkspaceDirectory("a", "revalidate"));
    expect(mock.request).toHaveBeenCalledTimes(reads); expect(host.textContent).not.toContain("Synthetic meeting");
    await render("b"); expect(host.textContent).toContain("Synthetic meeting"); expect(mock.request.mock.lastCall![1]).toBe("b");
  });

  it("fences pending schedules after an actual scoped lowercase 401 discard without an expiry event", async () => {
    host.dataset.workspaceScope = "synthetic-workspace";
    await render(); expect(host.textContent).toContain("Synthetic meeting");
    let resolve!: (value: unknown) => void, pendingUrl = "";
    mock.request.mockImplementationOnce((url: string) => { pendingUrl = url; return new Promise((done) => { resolve = done; }); });
    await act(async () => requestWorkspaceRefresh("a"));
    const signal = mock.request.mock.lastCall![2].signal as AbortSignal;
    const expiry = vi.fn(); window.addEventListener(WORKSPACE_SESSION_EXPIRED_EVENT, expiry);
    try {
      await act(async () => {
        const response = await workspaceSessionFetch("/api/workspace-sessions", undefined,
          async () => Response.json({ code: "authentication_required" }, { status: 401 }));
        expect(response.status).toBe(401);
        requestWorkspaceRefresh("a");
      });
      expect(expiry).not.toHaveBeenCalled(); expect(signal.aborted).toBe(true);
      expect(mock.request).toHaveBeenCalledTimes(2);
      expect(host.textContent).not.toContain("Synthetic meeting"); expect(host.textContent).toContain("登录已失效");
      await act(async () => resolve(payload(pendingUrl, [{ ...timeFixtureActivity, title: "Revoked private schedule" }])));
      expect(host.textContent).not.toContain("Revoked private schedule");
      await act(async () => invalidateWorkspaceDirectory(undefined, "revalidate"));
      expect(mock.request).toHaveBeenCalledTimes(2);
    } finally { window.removeEventListener(WORKSPACE_SESSION_EXPIRED_EVENT, expiry); }
  });

  it("ignores another binding's discard and revalidation while its authorized read is pending", async () => {
    await render(); let resolve!: (value: unknown) => void, pendingUrl = "";
    mock.request.mockImplementationOnce((url: string) => { pendingUrl = url; return new Promise((done) => { resolve = done; }); });
    await act(async () => requestWorkspaceRefresh("a"));
    const signal = mock.request.mock.lastCall![2].signal as AbortSignal;
    await act(async () => {
      invalidateWorkspaceDirectory("other", "discard");
      invalidateWorkspaceDirectory("other", "revalidate");
    });
    expect(signal.aborted).toBe(false); expect(mock.request).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain("Synthetic meeting"); expect(host.textContent).not.toContain("登录已失效");
    await act(async () => resolve(payload(pendingUrl, [{ ...timeFixtureActivity, title: "Still authorized" }])));
    expect(host.textContent).toContain("Still authorized");
  });

  it("retains a discard fence while the chosen date has no readable scope", async () => {
    await render(); const reads = mock.request.mock.calls.length;
    mock.query = "day=9999-12-31&tz=UTC"; await render();
    expect(host.textContent).toContain("此日期超出可读取范围");
    await act(async () => invalidateWorkspaceDirectory("a", "discard"));
    mock.query = "day=2026-09-21&tz=UTC"; await render();
    expect(host.textContent).toContain("登录已失效"); expect(host.textContent).not.toContain("Synthetic meeting");
    expect(mock.request).toHaveBeenCalledTimes(reads);
  });

  it("coalesces matching and global revalidation into fresh readback without discarding authorization", async () => {
    await render(); let resolve!: (value: unknown) => void, pendingUrl = "";
    mock.request.mockImplementationOnce((url: string) => { pendingUrl = url; return new Promise((done) => { resolve = done; }); });
    await act(async () => requestWorkspaceRefresh("a"));
    const signal = mock.request.mock.lastCall![2].signal as AbortSignal;
    mock.request.mockImplementation(async (url: string) => payload(url, [{ ...timeFixtureActivity, title: "Fresh after revalidation" }]));
    await act(async () => {
      invalidateWorkspaceDirectory("a", "revalidate");
      invalidateWorkspaceDirectory(undefined, "revalidate");
      invalidateWorkspaceDirectory("a", "revalidate");
    });
    expect(signal.aborted).toBe(true); expect(mock.request).toHaveBeenCalledTimes(3);
    expect(host.textContent).toContain("Fresh after revalidation"); expect(host.textContent).not.toContain("登录已失效");
    await act(async () => resolve(payload(pendingUrl, [{ ...timeFixtureActivity, title: "Pre-mutation stale schedule" }])));
    expect(host.textContent).not.toContain("Pre-mutation stale schedule");
    await act(async () => invalidateWorkspaceDirectory("a", "revalidate"));
    expect(mock.request).toHaveBeenCalledTimes(4);
  });

  it("withdraws a removed schedule after an authorized foreground read without storing content", async () => {
    sessionStorage.clear(); localStorage.clear(); await render(); expect(host.textContent).toContain("Synthetic meeting");
    mock.request.mockImplementation(async (url: string) => payload(url, []));
    await act(async () => requestWorkspaceRefresh("a", "foreground"));
    expect(host.textContent).not.toContain("Synthetic meeting"); expect(host.textContent).toContain("这段时间没有待进行");
    expect(sessionStorage.length).toBe(0); expect(localStorage.length).toBe(0);
    expect(timeHref(new URLSearchParams(mock.query), { upcoming: "30" })).toContain("day=2026-09-21");
  });

  it("shares visible refresh triggers, pauses in the background, and coalesces an in-flight interval read", async () => {
    vi.useFakeTimers(); Object.defineProperty(document, "hidden", { configurable: true, value: false });
    let resolve!: (value: unknown) => void, pendingUrl = "";
    mock.request.mockImplementationOnce((url: string) => { pendingUrl = url; return new Promise((done) => { resolve = done; }); });
    await render(); await act(async () => vi.advanceTimersByTimeAsync(22_000));
    expect(mock.request).toHaveBeenCalledTimes(1);
    await act(async () => resolve(payload(pendingUrl)));
    await act(async () => vi.advanceTimersByTimeAsync(10_000)); expect(mock.request).toHaveBeenCalledTimes(2);
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    await act(async () => vi.advanceTimersByTimeAsync(22_000)); expect(mock.request).toHaveBeenCalledTimes(2);
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    await act(async () => { window.dispatchEvent(new Event("visibilitychange")); await vi.advanceTimersByTimeAsync(1_000); });
    expect(mock.request).toHaveBeenCalledTimes(3);
  });

  it("fences an old request when a schedule mutation requests immediate shared readback", async () => {
    let resolve!: (value: unknown) => void, pendingUrl = "";
    mock.request.mockImplementationOnce((url: string) => { pendingUrl = url; return new Promise((done) => { resolve = done; }); });
    await render(); const oldSignal = mock.request.mock.calls[0]![2].signal as AbortSignal;
    mock.request.mockImplementation(async (url: string) => payload(url, [{ ...timeFixtureActivity, title: "Updated schedule" }]));
    await act(async () => requestWorkspaceRefresh("a"));
    expect(oldSignal.aborted).toBe(true);
    await act(async () => resolve(payload(pendingUrl, [{ ...timeFixtureActivity, title: "Obsolete schedule" }])));
    expect(host.textContent).toContain("Updated schedule"); expect(host.textContent).not.toContain("Obsolete schedule");
  });
});
