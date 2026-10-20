// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { CONTRACT_VERSION, type TimeScheduleRecord } from "@talent-signal/contracts";
const mock = vi.hoisted(() => ({ request: vi.fn(), read: vi.fn(), saved: vi.fn(), close: vi.fn(), dirty: vi.fn() }));
vi.mock("@/lib/time-workspace-client", async (original) => ({ ...await original<typeof import("@/lib/time-workspace-client")>(), timeRequest: mock.request, readTimeSchedule: mock.read }));
import { TimeScheduleEditor } from "./time-schedule-editor";
import { readTimeEditorDraft, rememberTimeEditorDraft } from "@/lib/time-workspace-storage";
import { pendingTimeOperation, TimeRequestError } from "@/lib/time-workspace-client";
import { timeFixtureSchedule } from "@/lib/test/time-fixtures";
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetAllMocks(); mock.read.mockResolvedValue(timeFixtureSchedule); sessionStorage.clear(); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); sessionStorage.clear(); });
async function render(record: TimeScheduleRecord | null = timeFixtureSchedule, refreshKey = 0) {
  await act(async () => root.render(createElement(TimeScheduleEditor, { record, day: "2026-09-21", zone: "Asia/Shanghai", personId: "", people: [], binding: "a", onSaved: mock.saved, onClose: mock.close, onDirtyChange: mock.dirty, refreshKey })));
}
async function submit() { await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); }
async function click(text: string) { const button = [...host.querySelectorAll("button")].find((b) => b.textContent === text); expect(button).toBeTruthy(); await act(async () => button!.click()); }
async function typeTitle(text: string) {
  await act(async () => {
    const input = host.querySelector<HTMLInputElement>("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
// Native key events: IME state and the native 229 code must be observable to
// the editor exactly as browsers report them.
async function pressEscape(target: Element, init: { composing?: boolean; ime229?: boolean; handled?: boolean; swallowed?: boolean } = {}) {
  const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  if (init.composing !== undefined) Object.defineProperty(event, "isComposing", { value: init.composing });
  if (init.ime229) Object.defineProperty(event, "keyCode", { value: 229 });
  if (init.handled) target.addEventListener("keydown", (e) => e.preventDefault(), { once: true });
  if (init.swallowed) target.addEventListener("keydown", (e) => e.stopPropagation(), { once: true });
  await act(async () => { target.dispatchEvent(event); });
}
function stubConfirm(accept: boolean) { const spy = vi.fn<(message: string) => boolean>(() => accept); vi.stubGlobal("confirm", spy); return spy; }
describe("rendered schedule recovery", () => {
  it("recovers a lost successful response without issuing a second write", async () => {
    mock.request.mockRejectedValue(new TypeError("network lost"));
    await render(); await submit();
    const receipt = pendingTimeOperation("a")!;
    expect(receipt.id).toBe(timeFixtureSchedule.id);
    expect(receipt.body).toMatchObject({ title: "Synthetic meeting", expected_revision: 1 });
    expect(host.textContent).toContain("操作可能已完成");
    expect(host.querySelector("fieldset")!.disabled).toBe(true);
    mock.read.mockResolvedValue({ ...timeFixtureSchedule, revision: 2, last_operation_id: receipt.key });
    await click("重新核实操作结果");
    expect(mock.request).toHaveBeenCalledTimes(1);
    expect(mock.saved).toHaveBeenCalledWith(expect.objectContaining({ revision: 2 }));
    expect(pendingTimeOperation("a")).toBeNull();
  });
  it("retries an uncommitted operation with exactly the same identity and content", async () => {
    mock.request.mockRejectedValueOnce(new TypeError("network lost"));
    await render(); await submit();
    const first = mock.request.mock.calls[0]!;
    mock.read.mockResolvedValue(timeFixtureSchedule);
    await click("重新核实操作结果");
    mock.request.mockImplementation(async (_url: string, _binding: string, request: RequestInit) => {
      const body = JSON.parse(request.body as string);
      return { contract_version: CONTRACT_VERSION, schedule: { ...timeFixtureSchedule, revision: 2, last_operation_id: body.idempotency_key } };
    });
    await submit();
    expect(mock.request.mock.calls[1]).toEqual(first);
    expect(pendingTimeOperation("a")).toBeNull();
  });
  it("keeps newer server content behind an explicit conflict decision", async () => {
    mock.request.mockRejectedValue(new TypeError("network lost"));
    await render(); await submit();
    mock.read.mockResolvedValue({ ...timeFixtureSchedule, revision: 3, title: "Newer server content" });
    await click("重新核实操作结果");
    expect(host.textContent).toContain("这条安排已有另一个版本");
    expect(host.querySelector("input")!.value).toBe("Synthetic meeting");
    await click("使用服务器版本");
    expect(host.querySelector("input")!.value).toBe("Newer server content");
    expect(mock.request).toHaveBeenCalledTimes(1);
  });
  it("cannot recover another account's pending operation", async () => {
    mock.request.mockRejectedValue(new TypeError("network lost"));
    await render(); await submit();
    expect(pendingTimeOperation("a")).not.toBeNull();
    expect(pendingTimeOperation("b")).toBeNull();
  });
  it("clears deleted content from an already-open editor on authority refresh", async () => {
    await render(); expect(host.querySelector("textarea")!.value).toBe("Private note");
    mock.read.mockResolvedValue({ ...timeFixtureSchedule, revision: 2, status: "deleted", content_available: false, title: null, note: null });
    await render(timeFixtureSchedule, 1);
    // Deleted content is terminal: no stale form, no old content, one compact
    // immediately visible view with heading, explanation and Close.
    expect(host.querySelector("form")).toBeNull();
    expect(host.querySelector("input")).toBeNull();
    expect(host.querySelector("textarea")).toBeNull();
    expect(host.querySelector("fieldset")).toBeNull();
    expect(host.querySelector("h2")!.textContent).toBe("这条安排已删除");
    expect(host.textContent).toContain("旧内容已清除");
    expect(host.textContent).not.toContain("Private note");
    expect([...host.querySelectorAll("button")].some((b) => b.textContent === "下载日历文件")).toBe(false);
    expect([...host.querySelectorAll("button")].some((b) => b.textContent === "删除安排")).toBe(false);
  });

  it("renders a compact terminal view with a working Close for a deleted deep link", async () => {
    mock.read.mockResolvedValue({ ...timeFixtureSchedule, revision: 2, status: "deleted", content_available: false, title: null, note: null });
    await render();
    expect(host.querySelector("form")).toBeNull();
    expect(host.querySelector("h2")!.textContent).toBe("这条安排已删除");
    expect(host.textContent).toContain("这条安排已删除，旧内容已清除。已导出的日历文件不会自动撤回。");
    expect(host.textContent).not.toContain("Synthetic meeting");
    expect(host.textContent).not.toContain("编辑安排");
    const close = [...host.querySelectorAll("button")].find((b) => b.textContent === "关闭");
    expect(close).toBeTruthy();
    await act(async () => close!.click());
    expect(mock.close).toHaveBeenCalledTimes(1);
  });

  it("renders an unavailable terminal view when the arrangement cannot be accessed", async () => {
    mock.read.mockRejectedValue(new TimeRequestError("gone", 404));
    await render();
    expect(host.querySelector("form")).toBeNull();
    expect(host.querySelector("h2")!.textContent).toBe("这条安排已不可访问");
    expect(host.textContent).toContain("这条安排已不可访问，旧内容已清除。");
    const close = [...host.querySelectorAll("button")].find((b) => b.textContent === "关闭");
    expect(close).toBeTruthy();
    await act(async () => close!.click());
    expect(mock.close).toHaveBeenCalledTimes(1);
  });

  it("clears private fields immediately when a deletion is acknowledged", async () => {
    await render();
    mock.read.mockImplementation(() => new Promise(() => {}));
    mock.request.mockImplementation(async (_url: string, _binding: string, request: RequestInit) => ({ contract_version: CONTRACT_VERSION, schedule: { ...timeFixtureSchedule, revision: 2, last_operation_id: JSON.parse(request.body as string).idempotency_key, status: "deleted", content_available: false, title: null, note: null, starts_at: null, ends_at: null, time_zone: null, kind: null, reminder_minutes: null } }));
    await click("删除安排"); await click("确认删除内容");
    // The acknowledged deletion replaces the form with the same compact
    // terminal view; no private field or stale form survives.
    expect(host.querySelector("form")).toBeNull();
    expect(host.querySelector("input")).toBeNull();
    expect(host.querySelector("textarea")).toBeNull();
    expect(host.querySelector("h2")!.textContent).toBe("这条安排已删除");
    expect(host.textContent).toContain("已导出的日历事件需在日历应用中处理");
    expect(pendingTimeOperation("a")).toBeNull();
  });

  it("recovers local storage failure without locking a new unsaved editor", async () => {
    await render(null);
    const spy = vi.spyOn(window.sessionStorage, "setItem").mockImplementationOnce(() => { throw new DOMException("quota", "QuotaExceededError"); });
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(host.querySelector("input"), "Unsent title"); host.querySelector("input")!.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(host.querySelector("fieldset")!.disabled).toBe(false);
    expect(host.textContent).toContain("未能在此标签页保留输入"); spy.mockRestore();
    await click("重试保留输入");
    expect(readTimeEditorDraft("a")?.fields.title).toBe("Unsent title");
    expect(host.textContent).not.toContain("未能在此标签页保留输入");
  });
});

describe("keyboard close contract", () => {
  it("closes a pristine editor on Escape from the Save control without confirmation or writes", async () => {
    await render(null);
    const confirm = stubConfirm(true);
    await pressEscape(host.querySelector('button[type="submit"]')!);
    expect(mock.close).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
    expect(mock.request).not.toHaveBeenCalled();
    expect(pendingTimeOperation("a")).toBeNull();
    expect(readTimeEditorDraft("a")).toBeNull();
  });

  it("keeps a dirty editor and its input when the Escape close confirmation is cancelled", async () => {
    await render(null); await typeTitle("Unsent title");
    const confirm = stubConfirm(false);
    await pressEscape(host.querySelector("input")!);
    expect(confirm).toHaveBeenCalledWith("离开会放弃尚未保存的修改。");
    expect(mock.close).not.toHaveBeenCalled();
    expect(host.querySelector("form")).not.toBeNull();
    expect(host.querySelector<HTMLInputElement>("input")!.value).toBe("Unsent title");
    expect(mock.request).not.toHaveBeenCalled();
    expect(pendingTimeOperation("a")).toBeNull();
  });

  it("closes a dirty editor on Escape only through the same confirmation decision", async () => {
    await render(null); await typeTitle("Unsent title");
    const confirm = stubConfirm(true);
    await pressEscape(host.querySelector("input")!);
    expect(confirm).toHaveBeenCalledWith("离开会放弃尚未保存的修改。");
    expect(mock.close).toHaveBeenCalledTimes(1);
    expect(mock.request).not.toHaveBeenCalled();
  });

  it("shares one close decision and message between Escape and the close control", async () => {
    await render(null); await typeTitle("Unsent title");
    const confirm = stubConfirm(false);
    await click("×");
    await pressEscape(host.querySelector("input")!);
    expect(mock.close).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledTimes(2);
    const messages = confirm.mock.calls.map(([message]) => message);
    expect(messages[0]).toBe("离开会放弃尚未保存的修改。");
    expect(messages[1]).toBe(messages[0]);
  });

  it("keeps the pending operation credentials when Escape closes an unverified editor", async () => {
    mock.request.mockRejectedValue(new TypeError("network lost"));
    await render(); await submit();
    const receipt = pendingTimeOperation("a")!;
    expect(receipt).not.toBeNull();
    const confirm = stubConfirm(true);
    await pressEscape(host.querySelector("section")!);
    expect(confirm).toHaveBeenCalledWith("操作结果尚未核实，关闭后可继续核实。");
    expect(mock.close).toHaveBeenCalledTimes(1);
    expect(pendingTimeOperation("a")).toEqual(receipt);
    expect(mock.request).toHaveBeenCalledTimes(1);
  });

  it("ignores Escape during an IME composition until the composition ends", async () => {
    await render(null);
    const input = host.querySelector("input")!;
    await act(async () => { input.dispatchEvent(new Event("compositionstart", { bubbles: true })); });
    await pressEscape(input, { composing: true });
    await pressEscape(input);
    expect(mock.close).not.toHaveBeenCalled();
    expect(host.querySelector("form")).not.toBeNull();
    await act(async () => { input.dispatchEvent(new Event("compositionend", { bubbles: true })); });
    await pressEscape(input);
    expect(mock.close).toHaveBeenCalledTimes(1);
  });

  it("ignores Escape reported as native IME keyCode 229", async () => {
    await render(null);
    await pressEscape(host.querySelector("input")!, { ime229: true });
    expect(mock.close).not.toHaveBeenCalled();
    await pressEscape(host.querySelector("input")!);
    expect(mock.close).toHaveBeenCalledTimes(1);
  });

  it("does not close on an Escape already handled by a child", async () => {
    await render(null);
    const input = host.querySelector("input")!;
    await pressEscape(input, { handled: true });
    expect(mock.close).not.toHaveBeenCalled();
    await pressEscape(input);
    expect(mock.close).toHaveBeenCalledTimes(1);
  });

  it("does not close on an Escape swallowed inside a child", async () => {
    await render(null);
    const input = host.querySelector("input")!;
    await pressEscape(input, { swallowed: true });
    expect(mock.close).not.toHaveBeenCalled();
    await pressEscape(input);
    expect(mock.close).toHaveBeenCalledTimes(1);
  });

  it("ignores Escape outside the editor surface", async () => {
    await render(null);
    await pressEscape(document.body);
    expect(mock.close).not.toHaveBeenCalled();
    await pressEscape(host.querySelector("input")!);
    expect(mock.close).toHaveBeenCalledTimes(1);
  });

  it("closes the terminal view on Escape without confirmation", async () => {
    mock.read.mockRejectedValue(new TimeRequestError("gone", 404));
    await render();
    const confirm = stubConfirm(true);
    const close = [...host.querySelectorAll("button")].find((b) => b.textContent === "关闭")!;
    await pressEscape(close);
    expect(mock.close).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("closes a pristine editor from the close control without confirmation", async () => {
    await render(null);
    const confirm = stubConfirm(true);
    await click("×");
    expect(mock.close).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
  });

});

describe("draft retention", () => {
  it("does not let an unmounted save completion erase a later draft", async () => {
    let resolve!: (value: unknown) => void;
    mock.request.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    await render(); await submit();
    const receipt = pendingTimeOperation("a")!;
    await act(async () => root.render(null));
    rememberTimeEditorDraft("a", { id: timeFixtureSchedule.id, existing: true, base_revision: 1, expires: Date.now() + 60000, fields: { title: "Later unsent title", note: "", person: "", start: "2026-09-21T09:00", end: "2026-09-21T09:30", zone: "Asia/Shanghai", allDay: false, kind: "meeting", reminder: "none", status: "planned" } });
    await act(async () => resolve({ contract_version: CONTRACT_VERSION, schedule: { ...timeFixtureSchedule, revision: 2, last_operation_id: receipt.key } }));
    expect(readTimeEditorDraft("a")?.fields.title).toBe("Later unsent title");
    expect(pendingTimeOperation("a")?.key).toBe(receipt.key); expect(mock.saved).not.toHaveBeenCalled();
  });

});
