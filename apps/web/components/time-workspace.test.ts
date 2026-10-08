// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONTRACT_VERSION } from "@talent-signal/contracts";
import { timeFixtureActivity, timeFixtureSchedule, timeFixtureMutation } from "@/lib/test/time-fixtures";
const mock = vi.hoisted(() => ({ query: "day=2026-09-21&tz=UTC", push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), request: vi.fn(), read: vi.fn() }));
const nativePush = window.history.pushState.bind(window.history);
const nativeReplace = window.history.replaceState.bind(window.history);
const router = { push: mock.push, replace: mock.replace, refresh: mock.refresh };
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(mock.query), useRouter: () => router }));
vi.mock("@/lib/time-workspace-client", async (original) => ({ ...await original<typeof import("@/lib/time-workspace-client")>(), timeRequest: mock.request, readTimeSchedule: mock.read }));
import { pendingTimeOperation, rememberTimeOperation, rememberTimeEditorDraft } from "@/lib/time-workspace-storage";
import { calendarLocalTime } from "@/lib/calendar-draft";
import { TimeWorkspace } from "./time-workspace";
import { WORKSPACE_SESSION_EXPIRED_EVENT } from "./workspace-session-request";
let root: Root, host: HTMLDivElement;
const pendingMutation = { ...timeFixtureMutation, expected_revision: 1, idempotency_key: "b2000000-0000-4000-8000-000000000099" };
const scope = { from: "2026-09-21", to: "2026-09-22", time_zone: "UTC" };
function payload(title = "Synthetic private activity", more = false) {
  return { contract_version: CONTRACT_VERSION, scope, activities: [{ ...timeFixtureActivity, kind: "person_created", title, ends_at: null, id: `person_created:${timeFixtureActivity.source_id}` }], next_cursor: more ? "next" : null, complete: !more, coverage_note: "Session retention 30 days", snapshot_at: "2026-09-21T00:00:00.000Z" };
}
async function render() { nativeReplace(null, "", `/workspace/meetings?${mock.query}`); await act(async () => { root.render(createElement(TimeWorkspace, { people: [], peopleError: null, binding: "a", legacyDraft: null })); }); }
async function click(label: string) { const button = [...host.querySelectorAll("button")].find((b) => b.textContent === label); expect(button).toBeTruthy(); await act(async () => button!.click()); }
beforeEach(() => {
  vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetAllMocks(); sessionStorage.clear(); mock.query = "day=2026-09-21&tz=UTC";
  vi.spyOn(window.history, "pushState").mockImplementation((data, unused, url) => { nativePush(data, unused, url); mock.push(String(url)); });
  vi.spyOn(window.history, "replaceState").mockImplementation((data, unused, url) => { nativeReplace(data, unused, url); mock.replace(String(url)); });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  mock.request.mockResolvedValue(payload()); mock.read.mockResolvedValue(timeFixtureSchedule);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); sessionStorage.clear(); });
describe("rendered time workspace", () => {
  it("composes rapid filter changes before the next router render", async () => {
    await render(); await click("筛选");
    const selects = host.querySelectorAll("select");
    await act(async () => {
      const person = selects[0]!, option = document.createElement("option"); option.value = timeFixtureActivity.source_id; option.textContent = "Synthetic"; person.append(option);
      person.value = timeFixtureActivity.source_id; person.dispatchEvent(new Event("change", { bubbles: true }));
      const kind = selects[1]!; kind.value = "schedule"; kind.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const actual = new URL(window.location.href).searchParams;
    expect(actual.get("person")).toBe(timeFixtureActivity.source_id);
    expect(actual.get("kind")).toBe("schedule");
    mock.query = actual.toString(); await render(); await click("周");
    expect(new URL(window.location.href).searchParams.get("person")).toBe(timeFixtureActivity.source_id);
    expect(new URL(window.location.href).searchParams.get("kind")).toBe("schedule");
  });

  it("advances twice when two next actions precede a router render", async () => {
    await render();
    await act(async () => { const next = host.querySelector<HTMLButtonElement>('button[aria-label="下一段时间"]')!; next.click(); next.click(); });
    expect(new URL(window.location.href).searchParams.get("day")).toBe("2026-09-23");
  });
  it("closes a selected editor when history moves to an entry without an item", async () => {
    mock.query += `&item=schedule:${timeFixtureSchedule.id}`; await render();
    expect(host.querySelector('input[maxlength="200"]')).not.toBeNull();
    mock.query = "day=2026-09-22&tz=UTC";
    nativeReplace(null, "", `/workspace/meetings?${mock.query}`);
    await act(async () => window.dispatchEvent(new PopStateEvent("popstate")));
    await render(); expect(host.querySelector('input[maxlength="200"]')).toBeNull();
  });

  it("preserves scope filters while changing calendar layout", async () => {
    mock.query += `&person=${timeFixtureActivity.source_id}&kind=session_activity`;
    await render(); await click("周");
    const next = mock.push.mock.calls[0]![0];
    expect(next).toContain(`person=${timeFixtureActivity.source_id}`); expect(next).toContain("kind=session_activity"); expect(next).toContain("view=week&range=week");
  });
  it("keeps read failures distinct from a successful empty range", async () => {
    mock.request.mockRejectedValue(new Error("Backend unavailable")); await render();
    expect(host.textContent).toContain("时间记录暂时无法读取"); expect(host.textContent).not.toContain("这段时间还没有记录");
    mock.request.mockResolvedValue({ ...payload(), activities: [] }); await click("重新读取");
    expect(host.textContent).toContain("这段时间还没有记录");
  });
  it("discards an old range's late response", async () => {
    let oldResolve!: (value: unknown) => void;
    mock.request.mockImplementationOnce(() => new Promise((resolve) => { oldResolve = resolve; }));
    await render(); mock.query = "day=2026-09-22&tz=UTC"; mock.request.mockResolvedValue({ ...payload("New range"), scope: { ...scope, from: "2026-09-22", to: "2026-09-23" } });
    await render(); await act(async () => oldResolve(payload("Obsolete private record")));
    expect(host.textContent).toContain("New range"); expect(host.textContent).not.toContain("Obsolete private record");
  });
  it("clears private records when the workspace session expires", async () => {
    await render(); expect(host.textContent).toContain("Synthetic private activity");
    await act(async () => window.dispatchEvent(new Event(WORKSPACE_SESSION_EXPIRED_EVENT)));
    expect(host.textContent).toContain("请重新登录"); expect(host.textContent).not.toContain("Synthetic private activity");
  });
  it("never presents an incomplete snapshot as an empty remainder", async () => {
    mock.request.mockResolvedValueOnce(payload("First page", true)); await render();
    expect(host.textContent).toContain("不能据此判断其余时段为空");
    mock.request.mockResolvedValue({ ...payload("Second page"), activities: [{ ...payload("Second page").activities[0]!, id: "another-activity" }] });
    await click("读取更多记录");
    expect(host.textContent).toContain("First page"); expect(host.textContent).toContain("Second page"); expect(host.textContent).not.toContain("不能据此判断其余时段为空");
  });
  it("keeps an unapplied saved intent after reload and retries the original payload", async () => {
    const receipt = { id: timeFixtureSchedule.id, key: pendingMutation.idempotency_key, method: "PUT" as const, expectedRevision: 1, expires: Date.now() + 60000, body: pendingMutation };
    rememberTimeOperation("a", receipt);
    await render(); await click("核实上次操作");
    expect(pendingTimeOperation("a")).toEqual(receipt);
    expect(host.textContent).toContain("原输入和操作 ID 已保留");
    mock.request.mockImplementation(async (url: string) => url.includes("schedules") ? { contract_version: CONTRACT_VERSION, schedule: { ...timeFixtureSchedule, revision: 2, last_operation_id: receipt.key } } : payload());
    await click("重试原操作");
    expect(mock.request.mock.calls.find(([url]) => url.includes("schedules"))?.[2]).toMatchObject({ method: "PUT", body: JSON.stringify(receipt.body) });
    expect(pendingTimeOperation("a")).toBeNull();
  });
  it("blocks selection and new work while recovery is unresolved", async () => {
    rememberTimeOperation("a", { id: timeFixtureSchedule.id, key: pendingMutation.idempotency_key, method: "PUT", expectedRevision: 1, expires: Date.now() + 60000, body: pendingMutation });
    let resolve!: (value: unknown) => void;
    mock.read.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    await render(); await click("核实上次操作"); await click("周");
    expect(mock.push).not.toHaveBeenCalled();
    expect([...host.querySelectorAll("button")].find((b) => b.textContent === "添加日程")!.disabled).toBe(true);
    await act(async () => resolve(timeFixtureSchedule));
    expect(host.textContent).toContain("原输入和操作 ID 已保留");
  });
  it("restores unsent input after returning to the workspace", async () => {
    rememberTimeEditorDraft("a", { id: timeFixtureSchedule.id, existing: true, base_revision: 1, expires: Date.now() + 60000, fields: { title: "Unsent edit", note: "Unsent note", person: "", start: calendarLocalTime(timeFixtureSchedule.starts_at!, "UTC").slice(0, 16), end: calendarLocalTime(timeFixtureSchedule.ends_at!, "UTC").slice(0, 16), zone: "UTC", allDay: false, kind: "meeting", reminder: "none", status: "planned" } });
    await render(); await click("恢复未保存编辑");
    expect(host.querySelector<HTMLInputElement>('input[maxlength="200"]')!.value).toBe("Unsent edit");
    expect(host.textContent).toContain("已恢复上次未保存的输入");
  });

  it.each([false, true])("keeps unsaved input through history and opens B after explicit discard (quota=%s)", async (quota) => {
    const a = timeFixtureSchedule, b = { ...a, id: "b1000000-0000-4000-8000-000000000099", title: "Schedule B" };
    mock.request.mockResolvedValue({ ...payload(), activities: [a, b].map((r) => ({ ...timeFixtureActivity, id: `schedule:${r.id}`, source_id: r.id, title: r.title })) });
    mock.read.mockImplementation(async (id: string) => id === a.id ? a : b);
    mock.query += `&item=schedule:${a.id}`; await render();
    if (quota) vi.spyOn(window.sessionStorage, "setItem").mockImplementation(() => { throw new DOMException("quota", "QuotaExceededError"); });
    await act(async () => {
      const input = host.querySelector<HTMLInputElement>('input[maxlength="200"]')!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Unpersisted input"); input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    mock.query = `day=2026-09-21&tz=UTC&item=schedule:${b.id}`; nativeReplace(null, "", `/workspace/meetings?${mock.query}`);
    await act(async () => window.dispatchEvent(new PopStateEvent("popstate"))); await render();
    expect(host.querySelector<HTMLInputElement>('input[maxlength="200"]')!.value).toBe("Unpersisted input");
    expect(mock.read.mock.calls.filter(([id]) => id === b.id)).toHaveLength(0);
    vi.stubGlobal("confirm", vi.fn(() => true));
    await act(async () => { const row = [...host.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')].find((r) => r.textContent?.includes("Schedule B"))!; row.click(); });
    mock.query = window.location.search.slice(1); await render();
    expect(host.querySelector<HTMLInputElement>('input[maxlength="200"]')!.value).toBe("Schedule B");
  });

  it("reopens A after a same-render A to B to A selection roundtrip", async () => {
    const a = timeFixtureSchedule, b = { ...a, id: "b1000000-0000-4000-8000-000000000099", title: "Schedule B" };
    mock.request.mockResolvedValue({ ...payload(), activities: [a, b].map((r) => ({ ...timeFixtureActivity, id: `schedule:${r.id}`, source_id: r.id, title: r.title })) });
    mock.read.mockImplementation(async (id: string) => id === a.id ? a : b);
    mock.query += `&item=schedule:${a.id}`; await render();
    const rows = host.querySelectorAll('button[aria-pressed]');
    const first = [...rows].find((r) => r.textContent?.includes(a.title!)) as HTMLButtonElement;
    const second = [...rows].find((r) => r.textContent?.includes(b.title!)) as HTMLButtonElement;
    await act(async () => { second.click(); first.click(); });
    expect(new URL(window.location.href).searchParams.get("item")).toBe(`schedule:${a.id}`);
    expect(host.querySelector<HTMLInputElement>('input[maxlength="200"]')!.value).toBe(a.title);
    await act(async () => { host.querySelector<HTMLButtonElement>('button[aria-label="关闭编辑"]')!.click(); first.click(); });
    expect(host.querySelector<HTMLInputElement>('input[maxlength="200"]')!.value).toBe(a.title);
  });

  it("waits for the selected URL to change instead of reopening the previous editor", async () => {
    const a = timeFixtureSchedule, b = { ...a, id: "b1000000-0000-4000-8000-000000000099", title: "Schedule B" };
    const records = [a, b];
    mock.request.mockResolvedValue({ ...payload(), activities: records.map((record) => ({ ...timeFixtureActivity, id: `schedule:${record.id}`, source_id: record.id, title: record.title })) });
    mock.read.mockImplementation(async (id: string) => records.find((record) => record.id === id)!);
    mock.query += `&item=schedule:${a.id}`; await render();
    expect(host.querySelector<HTMLInputElement>('input[maxlength="200"]')!.value).toBe(a.title);
    const second = [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("Schedule B"))!;
    await act(async () => second.click());
    expect(mock.read.mock.calls.filter(([id]) => id === a.id)).toHaveLength(2);
    mock.query = `day=2026-09-21&tz=UTC&item=schedule:${b.id}`; await render();
    expect(host.querySelector<HTMLInputElement>('input[maxlength="200"]')!.value).toBe("Schedule B");
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="关闭编辑"]')!.click());
    expect(host.querySelector('input[maxlength="200"]')).toBeNull();
    mock.query = "day=2026-09-21&tz=UTC"; await render();
    expect(host.querySelector('input[maxlength="200"]')).toBeNull();
  });

});

const admittedId = "b3000000-0000-4000-8000-000000000007";
const admittedSource = { ...timeFixtureActivity, id: `person_created:${admittedId}`, kind: "person_created" as const, source_id: admittedId, source_revision: 3, title: "EVIDENCE-ALPHA", summary: "", occurred_at: "2026-09-21T01:00:00.000Z", recorded_at: "2026-09-21T01:00:00.000Z", ends_at: null, local_day: "2026-09-21", person_id: null, person_label: null, relationship_context_id: null, context_label: null, session_id: null, status: "recorded" as const, authority: "system_record" as const };
function feedOf(activities: unknown[], more = false) {
  return { contract_version: CONTRACT_VERSION, scope, activities, next_cursor: more ? "next" : null, complete: !more, coverage_note: "Session retention 30 days", snapshot_at: "2026-09-21T00:00:00.000Z" };
}
function reviewPayload(overrides: Record<string, unknown> = {}) {
  return { contract_version: CONTRACT_VERSION, scope, generated_at: "2026-09-21T01:05:00.000Z", title: "REVIEW-ALPHA", body: "Private review body", sources: [admittedSource], complete: true, coverage_note: "Session retention 30 days", authority: "unconfirmed", external_effect: "none", ...overrides };
}
async function askWith(question: string) {
  await act(async () => {
    const textarea = host.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, question);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click("回顾当前范围");
}
async function toggleVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: state });
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
}
describe("review continuity", () => {
  it("renders the actual range response as readable prose without remote assets", async () => {
    mock.request.mockImplementation(async (url: string) => url.includes("/api/time/review") ? reviewPayload({body: "## 今日回顾\n\n确认 **时间**。\n\n1. 核对来源\n\n![tracking](https://example.com/pixel)"}) : feedOf([admittedSource]));
    await render(); await askWith("回顾");
    expect(host.querySelector("article h3")?.textContent).toBe("REVIEW-ALPHA");
    expect(host.querySelector("article strong")?.textContent).toBe("时间");
    expect(host.querySelector("article ol li")?.textContent).toContain("核对来源");
    expect(host.querySelector("article img")).toBeNull();
  });

  afterEach(() => { vi.useRealTimers(); Reflect.deleteProperty(document, "visibilityState"); });

  it("places one named collapsed review disclosure before the growing feed in DOM order", async () => {
    await render();
    const dock = host.querySelector("details")!;
    const canvas = host.querySelector('section[aria-label="时间记录"]')!;
    expect(dock.querySelector("summary")!.textContent).toContain("范围回顾");
    expect(dock.hasAttribute("open")).toBe(false);
    expect(dock.compareDocumentPosition(canvas) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps a completed review through the 60-second auto refresh with an explicit stale label", async () => {
    vi.useFakeTimers();
    mock.request.mockImplementation(async (url: string) => url.includes("/api/time/review") ? reviewPayload({ title: "ANSWER-ONE" }) : feedOf([admittedSource]));
    await render(); await askWith("问题一");
    expect(host.textContent).toContain("ANSWER-ONE"); expect(host.textContent).toContain("待核对的整理");
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    await act(async () => {});
    expect(host.textContent).toContain("ANSWER-ONE");
    expect(host.textContent).toContain("旧整理 · 未核实");
    expect(host.textContent).toContain("不作为当前事实");
    expect(host.textContent).not.toContain("待核对的整理");
  });

  it("keeps the review through foregrounding and marks it stale after the re-read", async () => {
    mock.request.mockImplementation(async (url: string) => url.includes("/api/time/review") ? reviewPayload({ title: "ANSWER-ONE" }) : feedOf([admittedSource]));
    await render(); await askWith("问题一");
    await toggleVisibility("hidden"); await toggleVisibility("visible");
    expect(host.textContent).toContain("ANSWER-ONE");
    expect(host.textContent).toContain("旧整理 · 未核实");
    expect(host.textContent).toContain("不作为当前事实");
  });

  it("clears the review when the calendar scope changes", async () => {
    mock.request.mockImplementation(async (url: string) => url.includes("/api/time/review") ? reviewPayload({ title: "ANSWER-ONE" }) : feedOf([admittedSource]));
    await render(); await askWith("问题一");
    expect(host.textContent).toContain("ANSWER-ONE");
    mock.query = "day=2026-09-22&tz=UTC"; await render();
    expect(host.textContent).not.toContain("ANSWER-ONE");
  });

  it("clears the review when the account binding changes", async () => {
    mock.request.mockImplementation(async (url: string) => url.includes("/api/time/review") ? reviewPayload({ title: "ANSWER-ONE" }) : feedOf([admittedSource]));
    await render(); await askWith("问题一");
    expect(host.textContent).toContain("ANSWER-ONE");
    await act(async () => { root.render(createElement(TimeWorkspace, { people: [], peopleError: null, binding: "b", legacyDraft: null })); });
    expect(host.textContent).not.toContain("ANSWER-ONE");
  });

  it("clears the review when the workspace session expires", async () => {
    mock.request.mockImplementation(async (url: string) => url.includes("/api/time/review") ? reviewPayload({ title: "ANSWER-ONE" }) : feedOf([admittedSource]));
    await render(); await askWith("问题一");
    await act(async () => window.dispatchEvent(new Event(WORKSPACE_SESSION_EXPIRED_EVENT)));
    expect(host.textContent).not.toContain("ANSWER-ONE");
    expect(host.textContent).not.toContain("Private review body");
  });

  it("clears generated prose when an admitted source changes", async () => {
    mock.request.mockImplementation(async (url: string) => url.includes("/api/time/review") ? reviewPayload({ title: "ANSWER-ONE" }) : feedOf([admittedSource]));
    await render(); await askWith("问题一");
    expect(host.textContent).toContain("EVIDENCE-ALPHA · 2026-09-21");
    mock.request.mockImplementation(async (url: string) => url.includes("/api/time/review") ? reviewPayload() : feedOf([{ ...admittedSource, source_revision: 4, title: "EVIDENCE-ALPHA-V2" }]));
    await toggleVisibility("hidden"); await toggleVisibility("visible");
    expect(host.textContent).not.toContain("ANSWER-ONE");
    expect(host.textContent).not.toContain("Private review body");
    expect(host.textContent).not.toContain("EVIDENCE-ALPHA ·");
    expect(host.textContent).toContain("旧回顾已清除");
  });

  it("clears the review and says so when an admitted source disappears from a complete readback", async () => {
    mock.request.mockImplementation(async (url: string) => url.includes("/api/time/review") ? reviewPayload({ title: "ANSWER-ONE" }) : feedOf([admittedSource]));
    await render(); await askWith("问题一");
    mock.request.mockImplementation(async (url: string) => url.includes("/api/time/review") ? reviewPayload() : feedOf([payload().activities[0]!]));
    await toggleVisibility("hidden"); await toggleVisibility("visible");
    expect(host.textContent).not.toContain("ANSWER-ONE");
    expect(host.textContent).not.toContain("EVIDENCE-ALPHA");
    expect(host.textContent).toContain("旧回顾已清除");
  });

  it("never establishes source absence from a partial first page", async () => {
    mock.request.mockImplementation(async (url: string) => url.includes("/api/time/review") ? reviewPayload({ title: "ANSWER-ONE" }) : feedOf([admittedSource]));
    await render(); await askWith("问题一");
    mock.request.mockImplementation(async (url: string) => url.includes("/api/time/review") ? reviewPayload() : feedOf([], true));
    await toggleVisibility("hidden"); await toggleVisibility("visible");
    expect(host.textContent).toContain("ANSWER-ONE");
    expect(host.textContent).toContain("分页未完成时不能据此认定来源不存在");
    expect(host.textContent).toContain("EVIDENCE-ALPHA · 2026-09-21（本次读取未覆盖，未核实）");
  });

  it("keeps the old review as unverified stale when the refresh fails", async () => {
    mock.request.mockImplementation(async (url: string) => url.includes("/api/time/review") ? reviewPayload({ title: "ANSWER-ONE" }) : feedOf([admittedSource]));
    await render(); await askWith("问题一");
    mock.request.mockImplementation(async (url: string) => url.includes("/api/time/review") ? reviewPayload() : Promise.reject(new Error("Transport down")));
    await toggleVisibility("hidden"); await toggleVisibility("visible");
    expect(host.textContent).toContain("时间记录暂时无法读取");
    expect(host.textContent).toContain("ANSWER-ONE");
    expect(host.textContent).toContain("旧整理 · 未核实");
    expect(host.textContent).toContain("不作为当前事实");
  });

  it("keeps the old answer tied to its own question when regeneration fails", async () => {
    mock.request.mockImplementation(async (url: string) => url.includes("/api/time/review") ? reviewPayload({ title: "ANSWER-ONE" }) : feedOf([admittedSource]));
    await render(); await askWith("问题一");
    mock.request.mockImplementation(async (url: string) => url.includes("/api/time/review") ? Promise.reject(new Error("Transport down")) : feedOf([admittedSource]));
    await askWith("问题二");
    expect(host.textContent).toContain("Transport down");
    expect(host.textContent).toContain("ANSWER-ONE");
    expect(host.textContent).toContain("回答的问题：问题一");
    expect(host.textContent).toContain("当前输入的问题不同");
    expect(host.textContent).toContain("旧整理 · 未核实");
  });

  it("releases the busy lock and recovers when a pending generation is canceled", async () => {
    let resolveReview!: (value: unknown) => void;
    mock.request.mockImplementation(async (url: string) => url.includes("/api/time/review") ? new Promise((resolve) => { resolveReview = resolve; }) : feedOf([admittedSource]));
    await render();
    await act(async () => {
      const textarea = host.querySelector("textarea")!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "问题一");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click("回顾当前范围");
    expect([...host.querySelectorAll("button")].find((b) => b.textContent === "正在回顾…")!.disabled).toBe(true);
    await toggleVisibility("hidden");
    expect([...host.querySelectorAll("button")].find((b) => b.textContent === "回顾当前范围")!.disabled).toBe(false);
    await act(async () => resolveReview(reviewPayload({ title: "ANSWER-LATE" })));
    expect(host.textContent).not.toContain("ANSWER-LATE");
    mock.request.mockImplementation(async (url: string) => url.includes("/api/time/review") ? reviewPayload({ title: "ANSWER-TWO" }) : feedOf([admittedSource]));
    await click("回顾当前范围");
    expect(host.textContent).toContain("ANSWER-TWO");
  });

  it("stores no model output or private review data in tab storage", async () => {
    mock.request.mockImplementation(async (url: string) => url.includes("/api/time/review") ? reviewPayload() : feedOf([admittedSource]));
    await render(); await askWith("问题一");
    expect(host.textContent).toContain("Private review body");
    expect(Object.keys(sessionStorage)).toHaveLength(0);
    expect(Object.keys(localStorage)).toHaveLength(0);
  });
});
