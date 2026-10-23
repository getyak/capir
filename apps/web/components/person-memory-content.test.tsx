// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MemoryRecallItem } from "@talent-signal/contracts";
import { PersonMemoryContent } from "./person-memory-content";
import { WorkspaceSessionBoundary } from "./workspace-session-boundary";

const fetcher = vi.hoisted(() => vi.fn());
vi.mock("./workspace-session-request", () => ({ workspaceSessionFetch: fetcher, WORKSPACE_SESSION_EXPIRED_EVENT: "session-expired" }));
const personId = "11111111-1111-4111-8111-111111111111";
const sessionId = "33333333-3333-4333-8333-333333333333";
function memory(overrides: Partial<MemoryRecallItem> & { can_edit?: boolean } = {}): MemoryRecallItem {
  return { id: "old", scope: "relationship", statement_kind: "source_statement", display_text: "对方计划下月参与试点", original_display_text: "对方计划下月参与试点", subject_id: personId,
    relationship_context_id: null, speaker: "对方", reporter: null, valid_time: null, observed_time: "2026-10-12T01:00:00Z",
    time_status: "future", sensitivity: "normal", version: 1, supersedes_id: null, conflict_group_id: null,
    evidence_retained: true, evidence_refs: [{ excerpt: "下个月可以聊一下试点", locator: { kind: "message", session_id: sessionId, message_id: "source-message" }, source_session_id: sessionId }],
    created_at: "2026-10-13T00:00:00Z", ...{ can_edit: true }, ...overrides };
}
let root: Root;
let host: HTMLDivElement;
async function mount(items = [memory()], more = false) {
  await act(async () => root.render(createElement(PersonMemoryContent, { personId, binding: "binding", entryCapability: "entry", initialItems: items, hasMore: more, nextCursor: more ? "signed-next" : null })));
}
function button(text: string) {
  const found = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(node => node.textContent === text);
  if (!found) throw new Error(`Missing button ${text}`); return found;
}
async function click(text: string) { await act(async () => button(text).click()); }
async function draft(value: string) {
  const textarea = host.querySelector<HTMLTextAreaElement>("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return textarea;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); fetcher.mockReset();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
describe("person document interactions", () => {
  it("names the three reading modes and preserves authority and temporal uncertainty", async () => {
    await mount(); expect(host.textContent).toContain("来源陈述 · 对方"); expect(host.textContent).toContain("来源中的计划 · 相对时间见来源（结果待核对）");
    for (const name of ["逐条记忆", "阅读概览", "原始摘录"]) expect(button(name)).toBeDefined();
    await click("阅读概览"); expect(host.textContent).toContain("不新增事实"); expect(host.textContent).toContain(memory().display_text);
    expect(host.querySelector("[data-memory-edit]")).toBeNull();
    await click("原始摘录"); expect(host.textContent).toContain("下个月可以聊一下试点");
    expect(host.querySelector(`a[href='/workspace/sessions/${sessionId}']`)).not.toBeNull();
    expect(host.textContent).not.toContain("最近往来");
  });
  it("does not expose obsolete raw text when the source is no longer retained", async () => {
    await mount([memory({ evidence_retained: false })]);
    expect(host.textContent).not.toContain("下个月可以聊一下试点");
    await click("原始摘录"); expect(host.textContent).toContain("暂无可读取"); expect(host.textContent).not.toContain("下个月可以聊一下试点");
  });
  it.each(["逐条记忆", "阅读概览", "原始摘录"])("does not describe unreadable memory as empty in %s", async mode => {
    await mount([memory()], true);
    await click(mode);
    fetcher.mockResolvedValueOnce(Response.json({}, { status: 404 }));
    await click("继续加载记忆");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("访问范围已不可用");
    expect(host.textContent).not.toContain("还没有已确认的记忆");
    expect(host.textContent).not.toContain("确认记忆后，这里会形成阅读概览");
    expect(host.textContent).not.toContain("暂无可读取的原始摘录");
    expect(host.textContent).not.toContain("0 条");
  });
  it("keeps editing in place, cancels without a write, and lets IME own Enter/Escape", async () => {
    await mount(); await click("修改"); const textarea = await draft("我补充的记忆");
    expect(document.activeElement).toBe(textarea); expect(button("阅读概览").disabled).toBe(true);
    await act(async () => {
      textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, isComposing: true, bubbles: true }));
      textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", isComposing: true, bubbles: true }));
    });
    expect(fetcher).not.toHaveBeenCalled(); expect(host.querySelector("textarea")).not.toBeNull();
    await click("取消"); expect(host.querySelector("textarea")).toBeNull(); expect(host.textContent).toContain(memory().display_text); expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(["Escape", "取消"])("returns focus to the remounted edit control after %s without writing", async action => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
    await mount();
    const original = host.querySelector<HTMLButtonElement>("[data-memory-edit='old']")!;
    await click("修改"); const textarea = await draft("尚未保存的修改");
    if (action === "Escape") await act(async () => textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    else await click("取消");
    await act(async () => { frames.splice(0).forEach(callback => callback(0)); });
    const restored = host.querySelector<HTMLButtonElement>("[data-memory-edit='old']")!;
    expect(restored).not.toBe(original); expect(original.isConnected).toBe(false);
    expect(document.activeElement).toBe(restored); expect(fetcher).not.toHaveBeenCalled();
    expect(host.textContent).toContain(memory().display_text); expect(host.querySelector("textarea")).toBeNull();
  });
  it("retains the edited draft through an unknown result and exposes explicit same-request recovery", async () => {
    await mount(); await click("修改"); await draft("对方说改为下季度"); fetcher.mockRejectedValueOnce(new Error("lost"));
    await click("保存修改"); expect(host.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("对方说改为下季度");
    expect(button("核对并重试")).toBeDefined(); expect(button("取消").disabled).toBe(true); expect(host.textContent).not.toContain("修改已保存");
    const replacement = memory({ id: "new", display_text: "对方说改为下季度", supersedes_id: "old", version: 2 });
    fetcher.mockResolvedValueOnce(Response.json({ status: "active", item: replacement }))
      .mockResolvedValueOnce(Response.json({ surface: "people", person_id: personId, items: [replacement], has_more: false, next_cursor: null }));
    await click("核对并重试");
    expect(host.querySelector("textarea")).toBeNull(); expect(host.textContent).toContain("用户修改"); expect(host.textContent).toContain("修改前保存的原句");
    expect(host.querySelector("[data-memory-edit='new']")).not.toBeNull(); expect(host.querySelector("[data-memory-edit='old']")).toBeNull();
    expect(fetcher.mock.calls[1]![1].body).toBe(fetcher.mock.calls[0]![1].body);
  });
  it("keeps the selected reading mode inert through saving and unknown recovery, then restores focus", async () => {
    // DOM state and interaction checks, not rendered contrast/native evidence.
    await mount(); await click("修改"); await draft("Synthetic GET-207 correction");
    let loseResponse!: (reason: Error) => void;
    fetcher.mockImplementationOnce(() => new Promise((_resolve, reject) => { loseResponse = reject; }));
    await click("保存修改");
    const selected = button("逐条记忆");
    const assertFrozenSelection = () => {
      expect(selected.getAttribute("aria-pressed")).toBe("true");
      for (const label of ["逐条记忆", "阅读概览", "原始摘录"]) {
        expect(button(label).disabled).toBe(true);
      }
      expect(host.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("Synthetic GET-207 correction");
      expect(host.querySelector<HTMLTextAreaElement>("textarea")?.disabled).toBe(true);
    };
    assertFrozenSelection();
    await click("阅读概览"); await click("原始摘录"); await click("逐条记忆");
    expect(fetcher).toHaveBeenCalledTimes(1);
    assertFrozenSelection();

    await act(async () => loseResponse(new Error("response lost")));
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(host.textContent).not.toContain("修改已保存");
    expect(button("取消").disabled).toBe(true);
    assertFrozenSelection();

    const replacement = memory({ id: "get207-replacement", display_text: "Synthetic GET-207 correction", supersedes_id: "old", version: 2 });
    fetcher.mockResolvedValueOnce(Response.json({ status: "active", item: replacement }))
      .mockResolvedValueOnce(Response.json({ surface: "people", person_id: personId, items: [replacement], has_more: false, next_cursor: null }));
    await click("核对并重试");
    expect(fetcher.mock.calls[1]![1].body).toBe(fetcher.mock.calls[0]![1].body);
    expect(host.querySelector("textarea")).toBeNull();
    expect(host.querySelectorAll("[data-memory-item='get207-replacement']")).toHaveLength(1);
    expect(host.querySelector("[data-memory-item='old']")).toBeNull();
    expect(document.activeElement).toBe(host.querySelector("[data-memory-edit='get207-replacement']"));
    expect(selected.getAttribute("aria-pressed")).toBe("true");
    expect(selected.disabled).toBe(false);
    await click("原始摘录");
    expect(button("原始摘录").getAttribute("aria-pressed")).toBe("true");
  });
  it.each(["逐条记忆", "阅读概览", "原始摘录"])("loads remaining data and focuses the first appended item in %s", async mode => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
    await mount([memory()], true); expect(host.textContent).toContain("1+ 条");
    await click(mode);
    fetcher.mockResolvedValueOnce(Response.json({ surface: "people", person_id: personId, items: [memory({ id: "second", display_text: "第二条已确认记忆" })], has_more: false, next_cursor: null }));
    await click("继续加载记忆"); expect(host.textContent).toContain("第二条已确认记忆"); expect(host.textContent).toContain("2 条");
    expect(fetcher.mock.calls[0]![0]).toContain("cursor=signed-next");
    await act(async () => { frames.splice(0).forEach(callback => callback(0)); });
    expect(document.activeElement).toBe(host.querySelector("[data-memory-item='second']"));
  });
  it("returns to the active mode when the final raw page has no retained excerpts", async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
    await mount([memory()], true); await click("原始摘录"); button("继续加载记忆").focus();
    fetcher.mockResolvedValueOnce(Response.json({ person_id: personId, items: [memory({ id: "not-retained", evidence_retained: false })], has_more: false }));
    await click("继续加载记忆");
    await act(async () => { frames.splice(0).forEach(callback => callback(0)); });
    expect(host.querySelector("[data-memory-item='not-retained']")).toBeNull();
    expect(document.activeElement).toBe(button("原始摘录"));
  });
  it("waits for the committed DOM when a frame runs before the final raw-page render", async () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
    await mount([memory()], true); await click("原始摘录"); button("继续加载记忆").focus();
    fetcher.mockResolvedValueOnce(Response.json({ person_id: personId, items: [memory({ id: "not-retained", evidence_retained: false })], has_more: false }));
    await click("继续加载记忆");
    expect(host.querySelector("[data-memory-load-more]")).toBeNull();
    expect(document.activeElement).toBe(button("原始摘录"));
  });
  it("focuses the saved replacement only after its edit button is committed", async () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
    await mount(); await click("修改"); await draft("核对并保存的修改");
    const replacement = memory({ id: "replacement", display_text: "核对并保存的修改", supersedes_id: "old", version: 2 });
    fetcher.mockResolvedValueOnce(Response.json({ status: "active", item: replacement }))
      .mockResolvedValueOnce(Response.json({ person_id: personId, items: [replacement], has_more: false }));
    await click("保存修改");
    expect(document.activeElement).toBe(host.querySelector("[data-memory-edit='replacement']"));
  });
  it("does not reclaim an already restored focus when refreshed items arrive", async () => {
    await mount(); await click("修改"); await click("取消");
    expect(document.activeElement).toBe(host.querySelector("[data-memory-edit='old']"));
    button("原始摘录").focus();
    await mount([memory(), memory({ id: "refreshed" })]);
    expect(document.activeElement).toBe(button("原始摘录"));
  });
  it("does not carry an old focus request into another account and person", async () => {
    await mount(); await click("修改");
    const outside = document.createElement("button"); document.body.append(outside);
    try {
      await act(async () => {
        button("取消").click();
        root.render(createElement(PersonMemoryContent, { personId: "22222222-2222-4222-8222-222222222222", binding: "another-account", entryCapability: "another-entry", initialItems: [memory({ id: "another-record" })] }));
        outside.focus();
      });
      expect(host.querySelector("textarea")).toBeNull();
      expect(document.activeElement).toBe(outside);
    } finally { outside.remove(); }
  });
  it("keeps the reader's new focus when a delayed page finishes", async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
    await mount([memory()], true); button("继续加载记忆").focus();
    let finish!: (response: Response) => void;
    fetcher.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
    await click("继续加载记忆");
    button("阅读概览").focus(); await click("阅读概览");
    await act(async () => finish(Response.json({ person_id: personId, items: [memory({ id: "second" })], has_more: false })));
    await act(async () => { frames.splice(0).forEach(callback => callback(0)); });
    expect(document.activeElement).toBe(button("阅读概览"));
  });
  it("preserves both active statements and their shared conflict label in every reading mode", async () => {
    const group = "22222222-2222-4222-8222-222222222222";
    await mount([memory({ conflict_group_id: group, display_text: "在上海工作" }), memory({ id: "other", conflict_group_id: group, display_text: "在北京工作" })]);
    for (const mode of ["逐条记忆", "阅读概览", "原始摘录"]) {
      await click(mode); expect(host.textContent).toContain("在上海工作"); expect(host.textContent).toContain("在北京工作");
      expect(host.querySelectorAll(`[data-conflict-group='${group}']`)).toHaveLength(2);
      expect(host.textContent!.match(/存在冲突 · 待核对/g)).toHaveLength(2);
    }
  });
  it("keeps a visible orphan draft after multiple supersessions and lets the user cancel explicitly", async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
    await mount(); await click("修改"); await draft("我的未保存草稿"); fetcher.mockResolvedValueOnce(Response.json({}, { status: 409 }));
    await click("保存修改"); fetcher.mockResolvedValueOnce(Response.json({ person_id: personId, items: [memory({ id: "v3", supersedes_id: "v2", version: 3 })], has_more: false }));
    await click("核对最新记忆"); expect(host.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("我的未保存草稿");
    expect(host.textContent).toContain("连续更新或不可用"); expect(host.querySelector("[data-memory-edit='old']")).toBeNull();
    await click("取消"); expect(host.querySelector("textarea")).toBeNull(); expect(host.querySelector("[data-memory-edit='v3']")).not.toBeNull();
    await act(async () => { frames.splice(0).forEach(callback => callback(0)); });
    expect(document.activeElement).toBe(button("逐条记忆"));
  });
  it("renders another owner's shared record without an edit control and retracts removed raw sources on refresh", async () => {
    await mount([memory({ can_edit: false })]); expect(host.textContent).toContain(memory().display_text); expect(host.querySelector("[data-memory-edit]")).toBeNull();
    await mount([memory({ can_edit: false, evidence_retained: false, evidence_refs: [] })]);
    expect(host.textContent).not.toContain("下个月可以聊一下试点"); await click("原始摘录"); expect(host.textContent).toContain("暂无可读取");
  });
  it.each([{ code: "session_stale" }, { error: { code: "session_stale" } }])("unmounts server-rendered private fields, raw evidence and draft after mutation 409 %j", async payload => {
    await act(async () => root.render(createElement(WorkspaceSessionBoundary, null,
      createElement("div", null, "私有公司和关系资料"),
      createElement(PersonMemoryContent, { personId, binding: "binding", entryCapability: "entry", initialItems: [memory()] }))));
    await click("修改"); await draft("私有未保存草稿"); fetcher.mockResolvedValueOnce(Response.json(payload, { status: 409 })); await click("保存修改");
    expect(host.textContent).toContain("登录已失效"); expect(host.textContent).not.toContain("私有公司和关系资料");
    expect(host.textContent).not.toContain("下个月可以聊一下试点"); expect(host.querySelector("textarea")).toBeNull();
    expect(host.querySelector("a")?.getAttribute("href")).toContain("reason=backend_session_expired");
  });
  it("unmounts the complete private boundary after a paginated read receives session_stale", async () => {
    await act(async () => root.render(createElement(WorkspaceSessionBoundary, null,
      createElement("div", null, "私有公司和关系资料"),
      createElement(PersonMemoryContent, { personId, binding: "binding", entryCapability: "entry", initialItems: [memory()], hasMore: true, nextCursor: "signed-next" }))));
    await click("原始摘录"); expect(host.textContent).toContain("下个月可以聊一下试点");
    fetcher.mockResolvedValueOnce(Response.json({ error: { code: "session_stale" } }, { status: 409 })); await click("继续加载记忆");
    expect(host.textContent).toContain("登录已失效"); expect(host.textContent).not.toContain("私有公司和关系资料"); expect(host.textContent).not.toContain("下个月可以聊一下试点");
  });
  it("keeps a dated historical plan source-bound without claiming its outcome or permanent future status", async () => {
    await mount([memory({ valid_time: "2026-01-12T00:00:00Z", display_text: "来源当时计划一月讨论试点" })]);
    expect(host.textContent).toContain("来源中的计划 · 2026年1月12日（结果待核对）"); expect(host.textContent).not.toContain("未来计划");
    await click("阅读概览"); expect(host.textContent).toContain("来源中的计划 · 2026年1月12日（结果待核对）");
  });
});
