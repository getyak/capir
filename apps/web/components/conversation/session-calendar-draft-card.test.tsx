// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MeetingDraftRecord } from "@talent-signal/contracts";

const fetcher = vi.hoisted(() => vi.fn());
vi.mock("../workspace-session-request", () => ({ workspaceSessionFetch: fetcher }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { SessionCalendarDraftCard } from "./session-calendar-draft-card";

const ID = "10000000-0000-4000-8000-000000000001";
const available: Extract<MeetingDraftRecord, { status: "needs_review" }> = {
  id: ID, external_effect: "none", revision: 2,
  source_task_id: "20000000-0000-4000-8000-000000000002",
  origin_session_id: "30000000-0000-4000-8000-000000000003",
  created_at: "2026-09-29T00:00:00.000Z", updated_at: "2026-09-29T00:00:00.000Z",
  expires_at: "2026-10-12T00:00:00.000Z",
  content_available: true, status: "needs_review", dismissed_at: null, redacted_at: null,
  title: "与林岚回访", starts_at: "2026-10-06T06:00:00.000Z", ends_at: "2026-10-06T06:30:00.000Z",
  time_zone: "Asia/Singapore", source_excerpt: "下周二下午两点我们再聊。",
  reference_time: "2026-09-29T00:00:00.000Z",
};

let mount: HTMLDivElement;
let root: Root;
async function flush() {
  await act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); });
}
function button(label: string) {
  return [...mount.querySelectorAll("button")].find((element) => element.textContent?.includes(label));
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fetcher.mockReset();
  fetcher.mockImplementation(() => Promise.resolve(Response.json({ draft: available, session_version: "binding-1" })));
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:calendar-test");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  mount = document.createElement("div"); document.body.append(mount); root = createRoot(mount);
});
afterEach(async () => {
  await act(async () => root.unmount()); mount.remove();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe("Session calendar draft card", () => {
  it("shows the current time, zone and exact source, then verifies before file generation", async () => {
    await act(async () => root.render(createElement(SessionCalendarDraftCard, { draftId: ID, binding: "binding-1", sessionId: available.origin_session_id })));
    await flush();
    expect(mount.textContent).toContain("与林岚回访");
    expect(mount.textContent).toContain("14:00–14:30");
    expect(mount.textContent).toContain("Asia/Singapore");
    expect(mount.textContent).toContain("下周二下午两点我们再聊。");
    expect(button("下载日历草稿")).toBeTruthy();
    expect(button("改时间")).toBeTruthy();
    expect(button("暂不安排")).toBeTruthy();
    await act(async () => button("下载日历草稿")!.click());
    await flush();
    const exportCall = fetcher.mock.calls.find(([url, init]) => String(url).endsWith(ID) && init?.method === "POST") as [string, RequestInit];
    expect(exportCall).toBeTruthy();
    expect(JSON.parse(exportCall[1].body as string)).toEqual({ expected_revision: 2 });
    expect(mount.textContent).toContain("已生成日历草稿，请在日历应用中确认导入");
    expect(mount.textContent).not.toContain("已加入日历");
  });

  it("keeps an empty in-progress time edit visible instead of crashing", async () => {
    await act(async () => root.render(createElement(SessionCalendarDraftCard, { draftId: ID, binding: "binding-1", sessionId: available.origin_session_id })));
    await flush();
    await act(async () => button("改时间")!.click());
    const start = mount.querySelector<HTMLInputElement>('input[type="datetime-local"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(start, "");
      start.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(mount.querySelector('input[type="datetime-local"]')).not.toBeNull();
    expect(mount.textContent).toContain("与林岚回访");
  });

  it("blocks a nonexistent daylight-saving time before export", async () => {
    const dst: MeetingDraftRecord = { ...available,
      starts_at: "2026-03-08T06:30:00.000Z", ends_at: "2026-03-08T07:30:00.000Z",
      time_zone: "America/New_York" };
    fetcher.mockResolvedValueOnce(Response.json({ draft: dst, session_version: "binding-1" }));
    await act(async () => root.render(createElement(SessionCalendarDraftCard, { draftId: ID, binding: "binding-1", sessionId: available.origin_session_id })));
    await flush();
    await act(async () => button("改时间")!.click());
    const start = mount.querySelector<HTMLInputElement>('input[type="datetime-local"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(start, "2026-03-08T02:30");
      start.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => button("下载日历草稿")!.click());
    await flush();
    expect(mount.textContent).toContain("夏令时");
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("refuses an export when the source is revoked after the card first appears", async () => {
    fetcher.mockImplementation((_url: string, init?: RequestInit) => Promise.resolve(
      init?.method === "POST"
        ? Response.json({ code: "MEETING_DRAFT_EXPORT_CONFLICT", message: "来源已变化" }, { status: 409 })
        : Response.json({ draft: available, session_version: "binding-1" }),
    ));
    await act(async () => root.render(createElement(SessionCalendarDraftCard, { draftId: ID, binding: "binding-1", sessionId: available.origin_session_id })));
    await flush();
    await act(async () => button("下载日历草稿")!.click());
    await flush();
    expect(mount.textContent).toContain("来源已变化");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(mount.textContent).not.toContain("已生成日历草稿");
  });

  it("does not send Not now if its recovery key cannot be stored", async () => {
    await act(async () => root.render(createElement(SessionCalendarDraftCard, { draftId: ID, binding: "binding-1", sessionId: available.origin_session_id })));
    await flush();
    const storage = vi.spyOn(window.sessionStorage, "setItem").mockImplementation(() => { throw new Error("storage unavailable"); });
    try {
      await act(async () => button("暂不安排")!.click());
      expect(mount.textContent).toContain("无法保存这次操作");
      expect(fetcher.mock.calls.some(([url]) => String(url).endsWith("/dismiss"))).toBe(false);
    } finally { storage.mockRestore(); }
  });

  it("records Not now on this card and removes export actions", async () => {
    const onDecisionState = vi.fn();
    const dismissed: MeetingDraftRecord = { ...available, status: "dismissed", dismissed_at: "2026-09-29T01:00:00.000Z", revision: 3 };
    fetcher.mockImplementation((url: string) => Promise.resolve(Response.json({
      draft: String(url).endsWith("/dismiss") ? dismissed : available,
      session_version: "binding-1",
    })));
    await act(async () => root.render(createElement(SessionCalendarDraftCard, { draftId: ID, binding: "binding-1", sessionId: available.origin_session_id, onDecisionState })));
    await flush();
    expect(onDecisionState).toHaveBeenLastCalledWith("pending");
    await act(async () => button("暂不安排")!.click());
    await flush();
    expect(onDecisionState).toHaveBeenLastCalledWith("resolved");
    expect(mount.textContent).toContain("本次不安排");
    expect(button("下载日历草稿")).toBeUndefined();
    const call = fetcher.mock.calls.find(([url]) => String(url).endsWith("/dismiss")) as [string, RequestInit];
    expect(JSON.parse(call[1].body as string).expected_revision).toBe(2);
  });

  it("checks an uncertain dismissal before showing a final receipt", async () => {
    const dismissed: MeetingDraftRecord = { ...available, status: "dismissed", dismissed_at: "2026-09-29T01:00:00.000Z", revision: 3 };
    let reads = 0;
    fetcher.mockImplementation((url: string) => {
      if (String(url).endsWith("/dismiss")) return Promise.reject(new Error("response lost"));
      reads += 1;
      return Promise.resolve(Response.json({ draft: reads > 1 ? dismissed : available, session_version: "binding-1" }));
    });
    await act(async () => root.render(createElement(SessionCalendarDraftCard, { draftId: ID, binding: "binding-1", sessionId: available.origin_session_id })));
    await flush();
    await act(async () => button("暂不安排")!.click());
    expect(mount.textContent).toContain("结果待核对");
    expect(button("下载日历草稿")).toBeUndefined();
    await act(async () => button("核对结果")!.click());
    await flush();
    expect(mount.textContent).toContain("本次不安排");
  });

  it("uses the saved revision when Not now follows an inline edit", async () => {
    const updated: MeetingDraftRecord = { ...available, title: "新的回访", revision: 3 };
    const dismissed: MeetingDraftRecord = { ...updated, status: "dismissed", dismissed_at: "2026-09-29T01:00:00.000Z", revision: 4 };
    fetcher.mockImplementation((url: string, init?: RequestInit) => Promise.resolve(Response.json({
      draft: String(url).endsWith("/dismiss") ? dismissed : init?.method === "PUT" ? updated : available,
      session_version: "binding-1",
    })));
    await act(async () => root.render(createElement(SessionCalendarDraftCard, { draftId: ID, binding: "binding-1", sessionId: available.origin_session_id })));
    await flush();
    await act(async () => button("改时间")!.click());
    const title = mount.querySelector<HTMLInputElement>('input[maxlength="200"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(title, "新的回访");
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => button("完成修改")!.click());
    await flush();
    await act(async () => button("暂不安排")!.click());
    const dismissCall = fetcher.mock.calls.find(([url]) => String(url).endsWith("/dismiss")) as [string, RequestInit];
    expect(JSON.parse(dismissCall[1].body as string).expected_revision).toBe(3);
  });

  it("retries an unresolved Not now with the original operation key", async () => {
    const dismissed: MeetingDraftRecord = { ...available, status: "dismissed", dismissed_at: "2026-09-29T01:00:00.000Z", revision: 3 };
    let posts = 0;
    fetcher.mockImplementation((url: string) => {
      if (String(url).endsWith("/dismiss")) {
        posts += 1;
        return posts === 1 ? Promise.reject(new Error("response lost"))
          : Promise.resolve(Response.json({ draft: dismissed, session_version: "binding-1" }));
      }
      return Promise.resolve(Response.json({ draft: available, session_version: "binding-1" }));
    });
    await act(async () => root.render(createElement(SessionCalendarDraftCard, { draftId: ID, binding: "binding-1", sessionId: available.origin_session_id })));
    await flush();
    await act(async () => button("暂不安排")!.click());
    await act(async () => button("核对结果")!.click());
    await flush();
    expect(button("重试原操作")).toBeTruthy();
    await act(async () => button("重试原操作")!.click());
    const bodies = fetcher.mock.calls.filter(([url]) => String(url).endsWith("/dismiss"))
      .map(([, init]) => JSON.parse((init as RequestInit).body as string));
    expect(bodies).toHaveLength(2);
    expect(bodies[0].idempotency_key).toBe(bodies[1].idempotency_key);
    expect(mount.textContent).toContain("本次不安排");
  });

  it("rejects a draft reference from another Session before displaying its content", async () => {
    await act(async () => root.render(createElement(SessionCalendarDraftCard, {
      draftId: ID, binding: "binding-1", sessionId: "40000000-0000-4000-8000-000000000004",
    })));
    await flush();
    expect(mount.textContent).toContain("不属于这段会话");
    expect(mount.textContent).not.toContain("与林岚回访");
    expect(button("下载日历草稿")).toBeUndefined();
  });

  it("blocks export when a fresh read reports a revoked source", async () => {
    const redacted: MeetingDraftRecord = { ...available, content_available: false, status: "redacted",
      title: null, starts_at: null, ends_at: null, time_zone: null, source_excerpt: null,
      reference_time: null, redacted_at: "2026-09-29T01:00:00.000Z", dismissed_at: null };
    fetcher.mockResolvedValueOnce(Response.json({ draft: redacted, session_version: "binding-1" }));
    await act(async () => root.render(createElement(SessionCalendarDraftCard, { draftId: ID, binding: "binding-1", sessionId: available.origin_session_id })));
    await flush();
    expect(mount.textContent).toContain("来源已失效");
    expect(button("下载日历草稿")).toBeUndefined();
  });
});
