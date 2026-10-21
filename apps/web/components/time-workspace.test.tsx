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
import { LocaleProvider } from "./locale-provider";
import { WORKSPACE_SESSION_EXPIRED_EVENT } from "./workspace-session-request";
let root: Root, host: HTMLDivElement;
const pendingMutation = { ...timeFixtureMutation, expected_revision: 1, idempotency_key: "b2000000-0000-4000-8000-000000000099" };
const scope = { from: "2026-09-21", to: "2026-09-22", time_zone: "UTC" };
function payload(title = "Synthetic private activity", more = false) {
  return { contract_version: CONTRACT_VERSION, scope, activities: [{ ...timeFixtureActivity, kind: "person_created", title, ends_at: null, id: `person_created:${timeFixtureActivity.source_id}` }], next_cursor: more ? "next" : null, complete: !more, coverage_note: "Session retention 30 days", snapshot_at: "2026-09-21T00:00:00.000Z" };
}
async function render() { nativeReplace(null, "", `/workspace/meetings?${mock.query}`); await act(async () => { root.render(createElement(TimeWorkspace, { people: [], peopleError: null, binding: "a", legacyDraft: null })); }); }
async function click(label: string) { const button = [...host.querySelectorAll("button")].find((b) => b.textContent === label); expect(button).toBeTruthy(); await act(async () => button!.click()); }
function addButton() { const button = [...host.querySelectorAll("button")].find((b) => b.textContent === "添加日程"); expect(button).toBeTruthy(); return button as HTMLButtonElement; }
async function typeEditorTitle(text: string) {
  await act(async () => {
    const input = host.querySelector<HTMLInputElement>('input[maxlength="200"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function escapeKey(init: { composing?: boolean; ime229?: boolean } = {}) {
  const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  if (init.composing !== undefined) Object.defineProperty(event, "isComposing", { value: init.composing });
  if (init.ime229) Object.defineProperty(event, "keyCode", { value: 229 });
  return event;
}
async function pressEscape(target: Element, init: { composing?: boolean; ime229?: boolean } = {}) {
  await act(async () => { target.dispatchEvent(escapeKey(init)); });
}
// The focus return is deferred past the close commit; one timer tick is enough.
async function flushFocus() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); }); }
beforeEach(() => {
  vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetAllMocks(); sessionStorage.clear(); mock.query = "day=2026-09-21&tz=UTC";
  vi.spyOn(window.history, "pushState").mockImplementation((data, unused, url) => { nativePush(data, unused, url); mock.push(String(url)); });
  vi.spyOn(window.history, "replaceState").mockImplementation((data, unused, url) => { nativeReplace(data, unused, url); mock.replace(String(url)); });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  mock.request.mockResolvedValue(payload()); mock.read.mockResolvedValue(timeFixtureSchedule);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); sessionStorage.clear(); });
describe("rendered time workspace", () => {
  it.each(["Failed to fetch", "Load failed", "NetworkError when attempting to fetch resource."])("localizes the network recovery hint for %s", async (message) => {
    mock.request.mockRejectedValue(new Error(message));
    await act(async () => {
      root.render(<LocaleProvider locale="en"><TimeWorkspace people={[]} peopleError={null} binding="a" legacyDraft={null} /></LocaleProvider>);
    });
    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Unable to connect. Please try again.");
    expect(host.textContent).toContain("Temporarily unavailable");
    expect(alert?.textContent).not.toContain("暂时连不上服务");
    mock.request.mockResolvedValue({ ...payload(), activities: [] });
    await act(async () => alert!.querySelector("button")!.click());
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
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
    expect(host.textContent).not.toContain("正在读取");
    expect(host.textContent).toContain("暂不可用");
    expect(host.textContent).toContain("时间记录暂时无法读取"); expect(host.textContent).not.toContain("这段时间还没有记录");
    mock.request.mockResolvedValue({ ...payload(), activities: [] }); await click("重新读取");
    expect(host.textContent).toContain("这段时间还没有记录");
    expect(host.textContent).not.toContain("暂不可用");
    expect(host.textContent).not.toContain("正在读取");
  });
  it("discards an old range's late response", async () => {
    let oldResolve!: (value: unknown) => void;
    mock.request.mockImplementationOnce(() => new Promise((resolve) => { oldResolve = resolve; }));
    await render(); mock.query = "day=2026-09-22&tz=UTC"; mock.request.mockResolvedValue({ ...payload("New range"), scope: { ...scope, from: "2026-09-22", to: "2026-09-23" } });
    await render(); await act(async () => oldResolve(payload("Obsolete private record")));
    expect(host.textContent).toContain("New range"); expect(host.textContent).not.toContain("Obsolete private record");
  });
  it("announces a new range as loading after the previous range failed", async () => {
    mock.request.mockRejectedValueOnce(new Error("Backend unavailable"));
    await render();
    let resolve!: (value: unknown) => void;
    mock.request.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    mock.query = "day=2026-09-22&tz=UTC";
    await render();
    expect(host.querySelector('[aria-label="时间记录"]')?.getAttribute("aria-busy")).toBe("true");
    expect(host.textContent).toContain("正在读取");
    expect(host.textContent).not.toContain("暂不可用");
    await act(async () => resolve({ ...payload(), scope: { ...scope, from: "2026-09-22", to: "2026-09-23" } }));
    expect(host.querySelector('[aria-label="时间记录"]')?.getAttribute("aria-busy")).toBe("false");
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

describe("keyboard focus return", () => {
  function readOnlySession() {
    return { ...timeFixtureActivity, kind: "session_activity" as const, id: `session_activity:${timeFixtureActivity.source_id}:2026-09-21`, title: "Synthetic session", summary: "One synthetic activity" };
  }
  function narrowViewport() {
    let matches = true;
    const listeners = new Set<() => void>();
    vi.stubGlobal("matchMedia", () => ({ get matches() { return matches; }, addEventListener: (_: string, listener: () => void) => listeners.add(listener), removeEventListener: (_: string, listener: () => void) => listeners.delete(listener) }));
    return (next: boolean) => { matches = next; listeners.forEach((listener) => listener()); };
  }
  it("opens a named narrow session dialog, preserves scope and returns to its clicked row", async () => {
    narrowViewport(); const activity = readOnlySession();
    mock.request.mockResolvedValue({ ...payload(), activities: [activity] });
    mock.query += "&kind=session_activity&view=timeline"; await render();
    const row = [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes(activity.title))!;
    await act(async () => row.querySelector("strong")!.click());
    mock.query = window.location.search.slice(1); await render();
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog!.contains(document.activeElement)).toBe(true);
    expect(document.getElementById(dialog!.getAttribute("aria-labelledby")!)?.textContent).toBe("记录详情");
    const returnToRow = vi.spyOn(row, "focus");
    await pressEscape(dialog!);
    await flushFocus();
    expect(returnToRow).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBe(dialog);
    mock.query = window.location.search.slice(1); await render(); await flushFocus();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(row);
    expect(new URLSearchParams(mock.query).get("kind")).toBe("session_activity");
    expect(new URLSearchParams(mock.query).get("day")).toBe("2026-09-21");
    expect(new URLSearchParams(mock.query).has("item")).toBe(false);
  });
  it.each(["session_activity", "person_created", "public_source_update"] as const)("preserves the person timeline and authority for read-only %s", async (kind) => {
    narrowViewport(); const activity = { ...readOnlySession(), kind, id: `${kind}:${timeFixtureActivity.source_id}`, person_id: timeFixtureActivity.source_id, authority: "unconfirmed" as const };
    mock.query += `&item=${activity.id}`;
    mock.request.mockResolvedValue({ ...payload(), activities: [activity] }); await render();
    const dialog = document.querySelector('[role="dialog"]')!; expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain("尚待核对");
    const timeline = [...dialog.querySelectorAll("button")].find((b) => b.textContent === "查看这个人的时间线")!;
    expect(timeline).toBeTruthy(); await act(async () => timeline.click());
    const actual = new URLSearchParams(window.location.search);
    expect(actual.get("person")).toBe(activity.person_id); expect(actual.get("range")).toBe("past7");
    expect(actual.has("item")).toBe(false);
  });
  it("explains blocked person navigation inside deep-linked details and keeps the unsent draft", async () => {
    narrowViewport(); const activity = { ...readOnlySession(), person_id: timeFixtureActivity.source_id };
    rememberTimeEditorDraft("a", { id: timeFixtureSchedule.id, existing: true, base_revision: 1, expires: Date.now() + 60000, fields: { title: "Unsent edit", note: "Unsent note", person: "", start: "2026-09-21T01:00", end: "2026-09-21T01:30", zone: "UTC", allDay: false, kind: "meeting", reminder: "none", status: "planned" } });
    mock.query += `&item=${activity.id}`; mock.request.mockResolvedValue({ ...payload(), activities: [activity] }); await render();
    const dialog = document.querySelector('[role="dialog"]')!;
    const focus = vi.spyOn(host.querySelector<HTMLElement>("main")!, "focus");
    await act(async () => [...dialog.querySelectorAll("button")].find((b) => b.textContent === "查看这个人的时间线")!.click());
    expect(dialog.textContent).toContain("请先恢复或放弃上次未保存的编辑。");
    expect(new URLSearchParams(window.location.search).get("item")).toBe(activity.id);
    expect(host.textContent).toContain("Unsent edit");
    const unrelated = new URLSearchParams(mock.query); unrelated.delete("item"); unrelated.set("person", activity.person_id); unrelated.set("view", "timeline"); unrelated.set("range", "past7");
    mock.query = unrelated.toString(); await render(); await flushFocus();
    expect(focus).not.toHaveBeenCalled();
  });
  it.each([false, true])("focuses the committed person scope once while its read is pending (same scope=%s)", async (sameScope) => {
    narrowViewport(); const activity = { ...readOnlySession(), person_id: timeFixtureActivity.source_id };
    mock.query += `${sameScope ? `&person=${activity.person_id}&view=timeline&range=past7` : ""}&item=${activity.id}`;
    mock.request.mockResolvedValue({ ...payload(), activities: [activity] }); await render();
    const main = host.querySelector<HTMLElement>("main")!, focus = vi.spyOn(main, "focus");
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) => b.textContent === "查看这个人的时间线")!.click());
    const targetQuery = window.location.search.slice(1);
    await flushFocus(); expect(focus).not.toHaveBeenCalled();
    let resolve!: (value: unknown) => void;
    if (!sameScope) mock.request.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    mock.query = targetQuery; await render(); await flushFocus();
    expect(document.activeElement).toBe(main); expect(focus).toHaveBeenCalledTimes(1);
    if (!sameScope) {
      expect(host.querySelector('[aria-label="时间记录"]')?.getAttribute("aria-busy")).toBe("true");
      await act(async () => resolve({ ...payload(), activities: [activity] })); await flushFocus();
      expect(focus).toHaveBeenCalledTimes(1);
    }
  });
  it("drops a person navigation intent after a different date commits", async () => {
    narrowViewport(); const activity = { ...readOnlySession(), person_id: timeFixtureActivity.source_id };
    mock.query += `&item=${activity.id}`; mock.request.mockResolvedValue({ ...payload(), activities: [activity] }); await render();
    const main = host.querySelector<HTMLElement>("main")!, focus = vi.spyOn(main, "focus");
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) => b.textContent === "查看这个人的时间线")!.click());
    const targetQuery = window.location.search.slice(1), other = new URLSearchParams(targetQuery); other.set("day", "2026-09-22");
    mock.query = other.toString(); await render(); await flushFocus(); expect(focus).not.toHaveBeenCalled();
    mock.query = targetQuery; await render(); await flushFocus(); expect(focus).not.toHaveBeenCalled();
  });
  it.each(["account", "history", "editor", "selection", "user focus", "expiry", "unmount"])("cancels queued person-scope focus on %s", async (reason) => {
    narrowViewport(); const activity = { ...readOnlySession(), person_id: timeFixtureActivity.source_id };
    mock.query += `&item=${activity.id}`; mock.request.mockResolvedValue({ ...payload(), activities: [activity] }); await render();
    const main = host.querySelector<HTMLElement>("main")!, focus = vi.spyOn(main, "focus");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) => b.textContent === "查看这个人的时间线")!.click());
      mock.query = window.location.search.slice(1); await render();
      expect(focus).not.toHaveBeenCalled();
      await act(async () => {
        if (reason === "account") root.render(createElement(TimeWorkspace, { people: [], peopleError: null, binding: "b", legacyDraft: null }));
        else if (reason === "history") window.dispatchEvent(new PopStateEvent("popstate"));
        else if (reason === "expiry") window.dispatchEvent(new Event(WORKSPACE_SESSION_EXPIRED_EVENT));
        else if (reason === "editor") addButton().click();
        else if (reason === "selection") host.querySelector<HTMLButtonElement>("[data-time-activity-id]")!.click();
        else if (reason === "user focus") addButton().focus();
        else root.unmount();
      });
      await act(async () => vi.runOnlyPendingTimersAsync());
      expect(focus).not.toHaveBeenCalled();
      if (reason === "unmount") root = createRoot(host);
    } finally { vi.useRealTimers(); }
  });
  it("keeps the narrow dialog mounted during a background read without showing obsolete content", async () => {
    narrowViewport(); const activity = readOnlySession();
    mock.query += `&item=${activity.id}`;
    mock.request.mockResolvedValueOnce({ ...payload(), activities: [activity] }); await render();
    const dialog = document.querySelector('[role="dialog"]'); expect(dialog).not.toBeNull();
    let resolve!: (value: unknown) => void;
    mock.request.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(document.querySelector('[role="dialog"]')).toBe(dialog);
    expect(dialog?.textContent).not.toContain(activity.summary);
    expect(dialog?.textContent).toContain("正在整理这段时间…");
    await act(async () => resolve({ ...payload(), activities: [] }));
    expect(document.querySelector('[role="dialog"]')).toBe(dialog);
    expect(dialog?.textContent).not.toContain(activity.summary);
    await act(async () => dialog!.querySelector<HTMLButtonElement>('button[aria-label="关闭详情"]')!.click());
    mock.query = window.location.search.slice(1); await render(); await flushFocus();
    expect(document.activeElement).toBe(addButton());
  });
  it("keeps IME Escape in the session dialog and clears it on session expiry without returning focus", async () => {
    narrowViewport(); const activity = readOnlySession(); mock.query += `&item=${activity.id}`;
    mock.request.mockResolvedValue({ ...payload(), activities: [activity] }); await render();
    const dialog = document.querySelector('[role="dialog"]')!; expect(dialog).not.toBeNull();
    await pressEscape(dialog, { composing: true });
    expect(new URLSearchParams(window.location.search).get("item")).toBe(activity.id);
    await pressEscape(dialog, { ime229: true });
    expect(new URLSearchParams(window.location.search).get("item")).toBe(activity.id);
    const focus = vi.spyOn(HTMLElement.prototype, "focus"); focus.mockClear();
    await act(async () => window.dispatchEvent(new Event(WORKSPACE_SESSION_EXPIRED_EVENT)));
    await flushFocus();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(host.textContent).toContain("请重新登录");
    expect(focus).not.toHaveBeenCalled();
  });
  it("recovers a failed refresh inside the same dialog and distinguishes incomplete coverage", async () => {
    narrowViewport(); const activity = readOnlySession(); mock.query += `&item=${activity.id}`;
    mock.request.mockResolvedValueOnce({ ...payload(), activities: [activity] }); await render();
    const dialog = document.querySelector('[role="dialog"]')!;
    mock.request.mockRejectedValueOnce(new Error("Backend unavailable"));
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(document.querySelector('[role="dialog"]')).toBe(dialog);
    expect(dialog.querySelector('[role="alert"]')?.textContent).toBe("Backend unavailable");
    expect(dialog.textContent).not.toContain(activity.summary);
    mock.request.mockResolvedValueOnce({ ...payload(), activities: [], complete: false, next_cursor: "next" });
    await act(async () => [...dialog.querySelectorAll("button")].find((b) => b.textContent === "重新读取")!.click());
    expect(document.querySelector('[role="dialog"]')).toBe(dialog);
    expect(dialog.textContent).toContain("当前只显示已读取的记录，不能据此判断其余时段为空。");
    expect(dialog.textContent).not.toContain("这份记录已不在当前范围。");
  });
  it("returns to the same activity after refresh replaces its original DOM row", async () => {
    narrowViewport(); const activity = readOnlySession();
    mock.request.mockResolvedValue({ ...payload(), activities: [activity] }); await render();
    const oldRow = host.querySelector<HTMLButtonElement>("[data-time-activity-id]")!;
    await act(async () => oldRow.click()); mock.query = window.location.search.slice(1); await render();
    let resolve!: (value: unknown) => void;
    mock.request.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(oldRow.isConnected).toBe(false);
    await act(async () => resolve({ ...payload(), activities: [activity] }));
    const newRow = host.querySelector<HTMLButtonElement>("[data-time-activity-id]")!;
    expect(newRow).not.toBe(oldRow);
    await act(async () => document.querySelector<HTMLButtonElement>('[role="dialog"] button[aria-label="关闭详情"]')!.click());
    mock.query = window.location.search.slice(1); await render(); await flushFocus();
    expect(document.activeElement).toBe(newRow);
  });
  it("keeps composition Escape and moves focus into desktop details across the breakpoint", async () => {
    const resize = narrowViewport(); const activity = readOnlySession(); mock.query += `&item=${activity.id}`;
    mock.request.mockResolvedValue({ ...payload(), activities: [activity] }); await render();
    const dialog = document.querySelector('[role="dialog"]')!;
    await act(async () => dialog.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })));
    await pressEscape(dialog);
    expect(new URLSearchParams(window.location.search).get("item")).toBe(activity.id);
    await act(async () => dialog.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })));
    await act(async () => resize(false)); await flushFocus();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(host.contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.textContent).toBe("记录详情");
    expect(new URLSearchParams(window.location.search).get("item")).toBe(activity.id);
    await act(async () => resize(true));
    expect(document.querySelector('[role="dialog"]')?.contains(document.activeElement)).toBe(true);
  });
  it("does not return focus to the old account or after history dismisses read-only details", async () => {
    narrowViewport(); const activity = readOnlySession(); mock.query += `&item=${activity.id}`;
    mock.request.mockResolvedValue({ ...payload(), activities: [activity] }); await render();
    const dialog = document.querySelector('[role="dialog"]')!;
    const focus = vi.spyOn(HTMLElement.prototype, "focus"); focus.mockClear();
    mock.query = "day=2026-09-21&tz=UTC";
    await act(async () => { nativeReplace(null, "", `/workspace/meetings?${mock.query}`); window.dispatchEvent(new PopStateEvent("popstate")); });
    await render(); await flushFocus();
    expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(focus).not.toHaveBeenCalled();
    mock.query += `&item=${activity.id}`; await render();
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[role="dialog"] button[aria-label="关闭详情"]')!.click();
      root.render(createElement(TimeWorkspace, { people: [], peopleError: null, binding: "b", legacyDraft: null }));
    });
    focus.mockClear(); await flushFocus(); expect(focus).not.toHaveBeenCalled();
    expect(dialog.isConnected).toBe(false);
  });
  it("returns focus to Add after Escape closes a blank new editor", async () => {
    await render();
    const add = addButton();
    await act(async () => add.click());
    expect(host.querySelector('input[maxlength="200"]')).not.toBeNull();
    await pressEscape(host.querySelector('input[maxlength="200"]')!);
    expect(host.querySelector('input[maxlength="200"]')).toBeNull();
    await flushFocus();
    expect(document.activeElement).toBe(add);
  });

  it("returns focus to the schedule row that opened the editor", async () => {
    mock.request.mockResolvedValue({ ...payload(), activities: [timeFixtureActivity] });
    await render();
    const row = [...host.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')].find((b) => b.textContent?.includes("Synthetic meeting"));
    expect(row).toBeTruthy();
    await act(async () => { row!.focus(); row!.click(); });
    mock.query = window.location.search.slice(1); await render();
    expect(host.querySelector('input[maxlength="200"]')).not.toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="关闭编辑"]')!.click());
    expect(host.querySelector('input[maxlength="200"]')).toBeNull();
    await flushFocus();
    expect(document.activeElement).toBe(row);
  });

  it("falls back to Add when a deep-linked editor closes", async () => {
    mock.query += `&item=schedule:${timeFixtureSchedule.id}`; await render();
    expect(host.querySelector('input[maxlength="200"]')).not.toBeNull();
    const add = addButton();
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="关闭编辑"]')!.click());
    await flushFocus();
    expect(document.activeElement).toBe(add);
  });

  it("returns focus to the clicked row when focus stayed on another row", async () => {
    const a = timeFixtureSchedule, b = { ...a, id: "b1000000-0000-4000-8000-000000000099", title: "Schedule B" };
    mock.request.mockResolvedValue({ ...payload(), activities: [a, b].map((r) => ({ ...timeFixtureActivity, id: `schedule:${r.id}`, source_id: r.id, title: r.title })) });
    mock.read.mockImplementation(async (id: string) => id === a.id ? a : b);
    await render();
    const rows = [...host.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')];
    const rowA = rows.find((r) => r.textContent?.includes(a.title!))!;
    const rowB = rows.find((r) => r.textContent?.includes(b.title))!;
    // A WebKit mouse click never moves focus: it stays on the previous row while
    // a nested title target of row B initiates the editor.
    rowA.focus();
    // Real input can run a microtask checkpoint between React's separate
    // native capture and bubble listeners. happy-dom's JS .click() otherwise
    // keeps an outer stack and misses that browser ordering.
    const microtasks: VoidFunction[] = [];
    const queue = vi.spyOn(globalThis, "queueMicrotask").mockImplementation((task) => { microtasks.push(task); });
    const checkpoint = () => { while (microtasks.length) microtasks.shift()!(); };
    host.addEventListener("click", checkpoint, { capture: true, once: true });
    await act(async () => {
      try { rowB.querySelector("strong")!.click(); }
      finally { queue.mockRestore(); checkpoint(); }
    });
    mock.query = window.location.search.slice(1); await render();
    expect(host.querySelector<HTMLInputElement>('input[maxlength="200"]')!.value).toBe(b.title);
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="关闭编辑"]')!.click());
    await flushFocus();
    expect(document.activeElement).toBe(rowB);
    expect(document.activeElement).not.toBe(rowA);
  });

  it("restores focus to a usable control after closing an unverified new schedule", async () => {
    await render();
    const add = addButton();
    await act(async () => add.click());
    await typeEditorTitle("Unsent new meeting");
    mock.request.mockImplementation(async (url: string) => url.includes("/api/time/schedules/") ? Promise.reject(new TypeError("network lost")) : payload());
    await act(async () => { [...host.querySelectorAll('button[type="submit"]')].find((b) => b.textContent === "保存安排")!.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(host.textContent).toContain("操作可能已完成");
    const receipt = pendingTimeOperation("a")!;
    expect(receipt).not.toBeNull();
    vi.stubGlobal("confirm", vi.fn(() => true));
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="关闭编辑"]')!.click());
    expect(host.querySelector('input[maxlength="200"]')).toBeNull();
    await flushFocus();
    // Add is disabled while the operation is unresolved; focus must land on a
    // control that can actually take it, never back on BODY.
    expect(add.disabled).toBe(true);
    const recovery = [...host.querySelectorAll("button")].find((b) => b.textContent === "核实上次操作")!;
    expect(recovery).toBeTruthy();
    expect(document.activeElement).toBe(recovery);
    expect((document.activeElement as HTMLButtonElement).disabled).toBe(false);
    expect(document.activeElement).not.toBe(document.body);
    expect(pendingTimeOperation("a")).toEqual(receipt);
  });

  it("cancels a pending focus return when the account binding changes", async () => {
    await render();
    const add = addButton();
    await act(async () => add.click());
    const input = host.querySelector<HTMLInputElement>('input[maxlength="200"]')!;
    // The binding change lands in the same task as the close, before the
    // deferred focus runs: no focus may cross to the next account.
    await act(async () => {
      input.dispatchEvent(escapeKey());
      root.render(createElement(TimeWorkspace, { people: [], peopleError: null, binding: "b", legacyDraft: null }));
    });
    expect(host.querySelector('input[maxlength="200"]')).toBeNull();
    await flushFocus();
    expect(add.isConnected).toBe(true);
    expect(document.activeElement).not.toBe(add);
  });

  it("cancels a pending focus return when the session expires", async () => {
    await render();
    const add = addButton();
    await act(async () => add.click());
    const input = host.querySelector<HTMLInputElement>('input[maxlength="200"]')!;
    await act(async () => {
      input.dispatchEvent(escapeKey());
      window.dispatchEvent(new Event(WORKSPACE_SESSION_EXPIRED_EVENT));
    });
    await flushFocus();
    expect(document.activeElement).not.toBe(add);
  });

  it("cancels a pending focus return when a new editor opens", async () => {
    await render();
    const add = addButton();
    await act(async () => add.click());
    const input = host.querySelector<HTMLInputElement>('input[maxlength="200"]')!;
    await act(async () => {
      input.dispatchEvent(escapeKey());
      add.click();
    });
    expect(host.querySelector('input[maxlength="200"]')).not.toBeNull();
    await flushFocus();
    expect(document.activeElement).not.toBe(add);
  });

  it("cancels a pending focus return when the workspace unmounts", async () => {
    await render();
    const add = addButton();
    await act(async () => add.click());
    const input = host.querySelector<HTMLInputElement>('input[maxlength="200"]')!;
    await act(async () => {
      input.dispatchEvent(escapeKey());
      root.unmount(); root = createRoot(host);
    });
    await flushFocus();
    expect(add.isConnected).toBe(false);
    expect(document.activeElement).not.toBe(add);
  });

  it("does not move focus after history navigation closes the editor", async () => {
    await render();
    const add = addButton();
    await act(async () => add.click());
    await click("周");
    expect(host.querySelector('input[maxlength="200"]')).toBeNull();
    await flushFocus();
    expect(add.isConnected).toBe(true);
    expect(document.activeElement).not.toBe(add);
  });

  it("does not move focus after a save completes", async () => {
    await render();
    const add = addButton();
    await act(async () => add.click());
    await typeEditorTitle("Booked");
    mock.request.mockImplementation(async (url: string, _binding: string, request: RequestInit) =>
      url.includes("/api/time/schedules/") ? { contract_version: CONTRACT_VERSION, schedule: { ...timeFixtureSchedule, revision: 1, last_operation_id: JSON.parse(request.body as string).idempotency_key } } : payload());
    const save = [...host.querySelectorAll<HTMLButtonElement>('button[type="submit"]')].find((b) => b.textContent === "保存安排")!;
    expect(save).toBeTruthy();
    save.focus();
    await act(async () => { save.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(host.textContent).toContain("已保存到时间工作台");
    await flushFocus();
    expect(document.activeElement).toBe(save);
    expect(document.activeElement).not.toBe(add);
  });
});
